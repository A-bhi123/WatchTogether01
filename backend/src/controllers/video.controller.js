const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { UPLOAD_DIR, ALLOWED_TYPES, hasValidSignature } = require('../config/upload');
const { probeVideo, planConversion, convertVideo } = require('../services/media.service');

function removeFile(filePath) {
  return fs.promises.unlink(filePath).catch(() => {});
}

// Browser se aaya naam kabhi latin1 mein padh liya jata hai; Hindi/emoji wale naam theek karne ke liye
function cleanDisplayName(originalName) {
  let name = Buffer.from(originalName, 'latin1').toString('utf8');
  if (name.includes('\uFFFD')) name = originalName;
  name = path.basename(name).replace(/[\u0000-\u001f]/g, '').trim();
  return (name || 'movie').slice(0, 150);
}

// Frontend ko sirf wahi data bhejo jo zaroori hai (disk ka path nahi)
function toClientVideo(row) {
  return {
    id: row.id,
    title: row.filename,
    size: Number(row.size),
    mimeType: row.mime_type,
    uploadedAt: row.created_at,
    url: `/api/videos/${row.id}/stream`,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    converted: row.converted,
  };
}

async function uploadVideo(req, res, next) {
  const room = req.room;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No video file received. Choose a file and try again.' });
  }

  const ext = path.extname(file.filename).toLowerCase();
  const uploadedPath = path.join(UPLOAD_DIR, file.filename);

  let outputPath = null; // convert hui to nayi file ka path
  let ffmpegProcess = null;
  let clientGone = false;

  // Banda tab band kar de ya cancel kare to ffmpeg ko bhi rok do
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      ffmpegProcess?.kill('SIGKILL');
    }
  });

  let finalName = file.filename;
  let finalExt = ext;
  let info = { videoCodec: null, audioCodec: null, converted: false };
  let warning = null;

  let inserted;
  let oldFiles = [];

  try {
    if (!(await hasValidSignature(uploadedPath, ext))) {
      await removeFile(uploadedPath);
      return res.status(415).json({ error: 'This file does not look like a real MP4, MKV or WebM video.' });
    }

    // Video aur audio ka codec dekho. Jo browser chala nahi sakta use theek karo.
    const probe = await probeVideo(uploadedPath);
    if (probe.status === 'unavailable') {
      // User ko kuch nahi dikhate, sirf backend ke terminal mein likhte hain
      console.warn(`[media] ffprobe unavailable (${probe.reason}); skipped the audio check for "${file.originalname}".`);
    } else if (probe.status === 'unreadable') {
      await removeFile(uploadedPath);
      return res.status(415).json({ error: 'This video file looks damaged or unreadable.' });
    } else {
      const plan = planConversion(ext, probe);

      if (plan.action === 'reject') {
        await removeFile(uploadedPath);
        return res.status(415).json({ error: plan.reason });
      }

      info = { videoCodec: probe.videoCodec, audioCodec: probe.audioCodec, converted: false };

      if (plan.action === 'convert') {
        const stem = path.parse(file.filename).name;
        finalName = `${stem}-c${plan.outputExt}`; // "-c" isliye ki mp4 se mp4 banate waqt naam na takraye
        finalExt = plan.outputExt;
        outputPath = path.join(UPLOAD_DIR, finalName);

        try {
          await convertVideo(uploadedPath, outputPath, plan, (child) => {
            ffmpegProcess = child;
          });
        } catch (err) {
          await removeFile(uploadedPath);
          await removeFile(outputPath);
          if (clientGone) return;
          console.error('Video conversion failed:', err.message);
          return res.status(422).json({
            error:
              'Could not convert this video for browser playback. Convert it to MP4 (H.264 + AAC) yourself and upload it again.',
          });
        }

        await removeFile(uploadedPath); // asli file ki ab zaroorat nahi
        info.converted = true;
        if (plan.audioMode === 'aac') info.audioCodec = 'aac';
        else if (plan.audioMode === 'opus') info.audioCodec = 'opus';
        else if (plan.audioMode === 'none') info.audioCodec = null;
        // 'copy' mein codec wahi rehta hai
      }
    }

    const finalPath = path.join(UPLOAD_DIR, finalName);

    if (clientGone) {
      await removeFile(finalPath);
      return;
    }

    const { size } = await fs.promises.stat(finalPath);

    // Transaction: nayi row daalo aur purani movie ki rows hatao, dono ek saath ya koi nahi
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const old = await client.query('SELECT id, filepath FROM videos WHERE room_id = $1', [room.id]);
      oldFiles = old.rows.map((row) => row.filepath);

      const result = await client.query(
        `INSERT INTO videos (room_id, uploaded_by, filename, filepath, mime_type, size, video_codec, audio_codec, converted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, filename, mime_type, size, created_at, video_codec, audio_codec, converted`,
        [
          room.id,
          req.user.id,
          cleanDisplayName(file.originalname),
          finalName,
          ALLOWED_TYPES[finalExt],
          size,
          info.videoCodec,
          info.audioCodec,
          info.converted,
        ]
      );
      inserted = result.rows[0];

      // Nayi movie: playback state 0:00 par, paused
      await client.query(
        `INSERT INTO watch_sessions (room_id, video_id, position_seconds, is_playing)
         VALUES ($1, $2, 0, false)
         ON CONFLICT (room_id) DO UPDATE
         SET video_id = EXCLUDED.video_id, position_seconds = 0, is_playing = false, updated_at = NOW()`,
        [room.id, inserted.id]
      );

      if (old.rows.length > 0) {
        await client.query('DELETE FROM videos WHERE id = ANY($1::int[])', [old.rows.map((row) => row.id)]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Kuch bhi bigda to is upload ki saari files hata do
    await removeFile(uploadedPath);
    if (outputPath) await removeFile(outputPath);
    return next(err);
  }

  // Yahan tak sab commit ho chuka hai. Ab safai aur room ko khabar.
  await Promise.all(oldFiles.map((name) => removeFile(path.join(UPLOAD_DIR, name))));

  const video = toClientVideo(inserted);
  req.app.get('io')?.to(room.room_code).emit('video:updated', video);

  res.status(201).json({ video, warning });
}

async function getRoomVideo(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, filename, mime_type, size, created_at, video_codec, audio_codec, converted
       FROM videos WHERE room_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.room.id]
    );
    res.json({ video: result.rows[0] ? toClientVideo(result.rows[0]) : null });
  } catch (err) {
    next(err);
  }
}

// "Range: bytes=START-END" ko padhta hai.
// Return: null (header ignore karo, poori file bhejo), { unsatisfiable: true }, ya { start, end }
function parseRange(header, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // samajh nahi aaya ya multi-range: ignore karna theek hai

  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;

  let start;
  let end;

  if (startText === '') {
    // "bytes=-500" matlab aakhri 500 bytes
    start = Math.max(fileSize - Number(endText), 0);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    // "bytes=1000-" matlab 1000 se file ke end tak
    end = endText === '' ? fileSize - 1 : Math.min(Number(endText), fileSize - 1);
  }

  if (start >= fileSize || start > end) return { unsatisfiable: true };
  return { start, end };
}

async function streamVideo(req, res, next) {
  try {
    const videoId = Number(req.params.id);
    if (!Number.isInteger(videoId) || videoId <= 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const result = await pool.query(
      'SELECT room_id, filepath, mime_type FROM videos WHERE id = $1',
      [videoId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const video = result.rows[0];

    // Sirf us room ke members dekh sakte hain
    const member = await pool.query(
      'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
      [video.room_id, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    const fullPath = path.join(UPLOAD_DIR, video.filepath);
    const stat = await fs.promises.stat(fullPath).catch(() => null);
    if (!stat || stat.size === 0) {
      return res.status(404).json({ error: 'The video file is missing on the server' });
    }

    const fileSize = stat.size;
    const range = req.headers.range ? parseRange(req.headers.range, fileSize) : null;

    const baseHeaders = {
      'Content-Type': video.mime_type,
      'Accept-Ranges': 'bytes', // "haan, main tukde bhej sakta hoon"
      'Cache-Control': 'private',
    };

    // 416: maangi gayi jagah file ke baahar hai
    if (range?.unsatisfiable) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }

    let status = 200;
    let start = 0;
    let end = fileSize - 1;
    const headers = { ...baseHeaders };

    if (range) {
      status = 206;
      start = range.start;
      end = range.end;
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
    }
    headers['Content-Length'] = end - start + 1; // tukde ki length, poori file ki nahi

    res.writeHead(status, headers);

    const stream = fs.createReadStream(fullPath, { start, end }); // end bhi shamil hota hai
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy()); // seek par browser purani request cancel karta hai
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadVideo, getRoomVideo, streamVideo };