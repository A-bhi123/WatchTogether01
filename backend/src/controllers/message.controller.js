const pool = require('../config/db');
const { safeDecrypt } = require('../services/crypto.service');

async function getMessages(req, res, next) {
  try {
    const code = req.params.code.toUpperCase();

    const roomResult = await pool.query('SELECT id FROM rooms WHERE room_code = $1', [code]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const roomId = roomResult.rows[0].id;

    const memberCheck = await pool.query(
      'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    // Clear chat ke baad ke messages, aur "Delete for me" wale messages nikaal kar
    const messages = await pool.query(
      `SELECT m.id, m.message, m.created_at,
              (m.deleted_at IS NOT NULL) AS is_deleted,
              m.deleted_by, du.name AS deleted_by_name,
              u.id AS user_id, u.name AS user_name
       FROM messages m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users du ON du.id = m.deleted_by
       JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $2
       WHERE m.room_id = $1
         AND (rm.chat_cleared_at IS NULL OR m.created_at > rm.chat_cleared_at)
         AND NOT EXISTS (
           SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $2
         )
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [roomId, req.user.id]
    );

    // Latest 100 uthaye (DESC), ab purane se naye order mein palat do, aur decrypt karo
    const rows = messages.rows.reverse().map((row) => ({ ...row, message: safeDecrypt(row.message) }));

    res.json({ messages: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMessages };