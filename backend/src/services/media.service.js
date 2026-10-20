const { spawn } = require('child_process');

// PATH mein na ho to .env mein poora path de sakte ho (FFMPEG_PATH / FFPROBE_PATH)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// Chrome, Edge aur Firefox mein bina dikkat chalne wale codecs
const SAFE_VIDEO = ['h264', 'vp8', 'vp9', 'av1'];
const SAFE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

// Ek program chalao. Program na mile ya Windows use block kare to reject hota hai (error event)
function run(command, args, { timeoutMs = 60000, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // args array hai (shell nahi), isliye file ke naam se command injection nahi ho sakta
      child = spawn(command, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000); // sirf aakhri hissa chahiye
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// File ke andar kaun sa video aur audio codec hai
// status: 'unavailable' (ffprobe nahi mila/block), 'unreadable' (file kharab), 'ok'
async function probeVideo(filePath) {
  let result;
  try {
    result = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', filePath], {
      timeoutMs: 30000,
    });
  } catch (err) {
    console.warn('[media] ffprobe could not be started:', err.code, err.message);
    return { status: 'unavailable', reason: err.code || 'UNKNOWN' };
  }
  
  if (result.code !== 0) return { status: 'unreadable' };

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    return { status: 'unreadable' };
  }

  const streams = data.streams || [];
  // Cover art (chhoti tasveer) ko video na samjho
  const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.find((s) => s.codec_type === 'audio'); // pehla audio track

  return {
    status: 'ok',
    videoCodec: video ? video.codec_name : null,
    audioCodec: audio ? audio.codec_name : null,
  };
}

// Faisla: file jaisi hai waisi rakho, badlo, ya mana kar do
function planConversion(ext, { videoCodec, audioCodec }) {
  if (!videoCodec) {
    return { action: 'reject', reason: 'No video stream was found in this file.' };
  }
  if (!SAFE_VIDEO.includes(videoCodec)) {
    return {
      action: 'reject',
      reason: `This movie uses the "${videoCodec}" video format, which browsers cannot play. Convert it to MP4 (H.264) with HandBrake or ffmpeg and upload it again.`,
    };
  }

  const audioOk = audioCodec === null || SAFE_AUDIO.includes(audioCodec);
  if (audioOk && ext !== '.mkv') return { action: 'keep' };

  // vp8 sirf webm mein rakh sakte hain, baaki sab MP4 mein
  const toWebm = videoCodec === 'vp8';
  const outputExt = toWebm ? '.webm' : '.mp4';

  let audioMode;
  if (audioCodec === null) audioMode = 'none';
  else if (toWebm) audioMode = ['opus', 'vorbis'].includes(audioCodec) ? 'copy' : 'opus';
  else audioMode = ['aac', 'mp3'].includes(audioCodec) ? 'copy' : 'aac';

  return { action: 'convert', outputExt, audioMode };
}

// Video ko jaisa hai waisa copy karo (tez), sirf awaaz (zarurat ho to) badlo
async function convertVideo(inputPath, outputPath, plan, onSpawn) {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-map', '0:v:0'];
  if (plan.audioMode !== 'none') args.push('-map', '0:a:0');
  args.push('-sn', '-dn', '-c:v', 'copy'); // subtitles/data hatao, video copy

  if (plan.audioMode === 'copy') args.push('-c:a', 'copy');
  else if (plan.audioMode === 'aac') args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2'); // stereo
  else if (plan.audioMode === 'opus') args.push('-c:a', 'libopus', '-b:a', '128k', '-ac', '2');

  if (plan.outputExt === '.mp4') args.push('-movflags', '+faststart'); // jaldi shuru ho aur seek tez ho
  args.push(outputPath);

  const result = await run(FFMPEG, args, { timeoutMs: 60 * 60 * 1000, onSpawn });
  if (result.code !== 0) {
    throw new Error(`ffmpeg exited with code ${result.code}: ${result.stderr.slice(-500)}`);
  }
}

async function logMediaToolStatus() {
  for (const [name, command] of [['ffprobe', FFPROBE], ['ffmpeg', FFMPEG]]) {
    try {
      const result = await run(command, ['-version'], { timeoutMs: 10000 });
      console.log(`[media] ${name}: OK (${result.stdout.split('\n')[0].trim()})`);
    } catch (err) {
      const why = err.code === 'ENOENT' ? 'not found in PATH' : `could not start (${err.code || err.message})`;
      console.warn(`[media] ${name}: UNAVAILABLE - ${why}.`);
    }
  }
}

module.exports = { probeVideo, planConversion, convertVideo, logMediaToolStatus };