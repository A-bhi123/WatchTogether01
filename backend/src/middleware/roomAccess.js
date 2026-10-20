const pool = require('../config/db');

// Room ka member hona zaroori
async function requireRoomMember(req, res, next) {
  try {
    const code = req.params.code.toUpperCase();

    const roomResult = await pool.query(
      'SELECT id, room_code, host_id FROM rooms WHERE room_code = $1',
      [code]
    );
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = roomResult.rows[0];

    const member = await pool.query(
      'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room.id, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    req.room = room;
    next();
  } catch (err) {
    next(err);
  }
}

// Member hona AUR host hona zaroori
function requireRoomHost(req, res, next) {
  requireRoomMember(req, res, (err) => {
    if (err) return next(err);
    if (req.room.host_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the host can do this' });
    }
    next();
  });
}

module.exports = { requireRoomMember, requireRoomHost };