const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('../config/upload');
const MAX_ROOM_MEMBERS = Number(process.env.MAX_ROOM_MEMBERS) || 10; // mesh video ke liye bade room theek nahi

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // confusing chars (0,O,1,I) hataye
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function createRoom(req, res, next) {
      const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!rawName) {
    return res.status(400).json({ error: 'Room name is required' });
  }
  if (rawName.length > 60) {
    return res.status(400).json({ error: 'Room name is too long (max 60 characters)' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Collision se bachne ke liye max 5 tries
    let roomCode;
    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      roomCode = generateRoomCode();
      try {
        const result = await client.query(
          `INSERT INTO rooms (room_code, name, host_id, status) VALUES ($1, $2, $3, 'active')
           RETURNING id, room_code, name, host_id, status, created_at`,
          [roomCode, rawName, req.user.id]
        );
        inserted = result.rows[0];
        break; // mil gaya, loop se bahar
      } catch (err) {
        if (err.code === '23505') continue; // unique violation = code already used, dobara try karo
        throw err;
      }
    }

    if (!inserted) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Could not generate a unique room code. Please try again.' });
    }

    await client.query(
      'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)',
      [inserted.id, req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ room: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

async function getMyRooms(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT r.id, r.room_code, r.name, r.status, r.created_at,
              (r.host_id = $1) AS is_host,
              (SELECT COUNT(*) FROM room_members rm2 WHERE rm2.room_id = r.id) AS member_count
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [req.user.id]
    );
    res.json({ rooms: result.rows });
  } catch (err) {
    next(err);
  }
}

async function getRoomByCode(req, res, next) {
  try {
    const code = req.params.code.toUpperCase();

    const roomResult = await pool.query(
      `SELECT r.id, r.room_code, r.name, r.status, r.host_id, r.chat_enabled, u.name AS host_name
       FROM rooms r JOIN users u ON u.id = r.host_id
       WHERE r.room_code = $1`,
      [code]
    );
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = roomResult.rows[0];

    const membersResult = await pool.query(
      `SELECT u.id, u.name, (u.id = $2) AS is_host
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1
       ORDER BY rm.joined_at ASC`,
      [room.id, room.host_id]
    );

    const isMember = membersResult.rows.some((m) => m.id === req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    if (room.status !== 'active') {
      return res.status(410).json({ error: 'This room has ended.' });
    }

    res.json({
      room: {
        code: room.room_code,
        name: room.name,
        status: room.status,
        chatEnabled: room.chat_enabled,
        hostName: room.host_name,
        isHost: room.host_id === req.user.id,
      },
      members: membersResult.rows,
    });
  } catch (err) {
    next(err);
  }
}

async function joinRoom(req, res, next) {
  try {
    const code = req.params.code.trim().toUpperCase();

    const roomResult = await pool.query(
      'SELECT id, room_code, name, status FROM rooms WHERE room_code = $1',
      [code]
    );
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found. Check the code and try again.' });
    }
    const room = roomResult.rows[0];

    if (room.status !== 'active') {
      return res.status(400).json({ error: 'This room is no longer active.' });
    }
    
    // Host ne nikala hua banda code ya link se bhi wapas nahi aa sakta
    const ban = await pool.query(
      'SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2',
      [room.id, req.user.id]
    );
    if (ban.rows.length > 0) {
      return res.status(403).json({ error: 'The host has removed you from this room.' });
    }

    // Pehle se member hai ya nahi, check karo
    const existing = await pool.query(
      'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room.id, req.user.id]
    );

    if (existing.rows.length === 0) {
    // Naye member ke liye jagah honi chahiye (purana member hamesha wapas aa sakta hai)
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS total FROM room_members WHERE room_id = $1',
        [room.id]
      );
      if (countResult.rows[0].total >= MAX_ROOM_MEMBERS) {
        return res.status(403).json({ error: `This room is full (maximum ${MAX_ROOM_MEMBERS} people).` });
      }
      // Naya member — insert karo
      await pool.query(
        'INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)',
        [room.id, req.user.id]
      );
    }
    // Agar already member hai (naya ya purana), kuch insert nahi karna — seedha allow

    res.json({ room: { code: room.room_code, name: room.name } });
  } catch (err) {
    next(err);
  }
}

async function deleteRoom(req, res, next) {
  try {
    const code = req.params.code.trim().toUpperCase();

    const roomResult = await pool.query('SELECT id, host_id FROM rooms WHERE room_code = $1', [code]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = roomResult.rows[0];

    const memberCheck = await pool.query(
      'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room.id, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    // Member: room doosron ke liye jaisa hai waisa rahega, bas apni list se hat jata hai
    if (room.host_id !== req.user.id) {
      await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [room.id, req.user.id]);
      // Ab wo member nahi raha, to uska live connection bhi band (warna chat chalti rehti)
      const io = req.app.get('io');
      if (io) {
        const sockets = await io.in(code).fetchSockets();
        sockets.filter((s) => s.user.id === req.user.id).forEach((s) => s.disconnect(true));
      }
      return res.json({ deleted: true, scope: 'me' });
    }

    // Host: room hamesha ke liye. Pehle movie ki file ke naam yaad rakho (row hatne ke baad nahi milenge)
    const videos = await pool.query('SELECT filepath FROM videos WHERE room_id = $1', [room.id]);

    // Ek DELETE se members, messages, videos, playback state, bans sab apne aap hat jate hain (CASCADE)
    await pool.query('DELETE FROM rooms WHERE id = $1', [room.id]);

    // Jo log abhi room ke andar hain unhe bahar bhejo
    const io = req.app.get('io');
    if (io) {
      const sockets = await io.in(code).fetchSockets();
      sockets.forEach((s) => {
        s.emit('room:closed');
        s.disconnect(true);
      });
    }

    // Disk se movie ki files hatao (database ka CASCADE inhe nahi hata sakta)
    await Promise.all(
      videos.rows.map((row) => fs.promises.unlink(path.join(UPLOAD_DIR, row.filepath)).catch(() => {}))
    );

    res.json({ deleted: true, scope: 'everyone' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyRooms, createRoom,getRoomByCode, joinRoom, deleteRoom  };