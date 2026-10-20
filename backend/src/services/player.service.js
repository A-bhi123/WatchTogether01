const pool = require('../config/db');

// Abhi ki asli position, database ki apni clock se (browsers ki clock ka koi chakkar nahi).
// Server sirf ek "reference point" rakhta hai: "updated_at par position X thi".
// Agar play ho raha hai to ab ki position = X + (ab - updated_at).
async function getPlayerState(roomId) {
  const result = await pool.query(
    `SELECT video_id, is_playing,
            CASE
              WHEN is_playing THEN position_seconds + EXTRACT(EPOCH FROM (NOW() - updated_at))
              ELSE position_seconds
            END AS position
     FROM watch_sessions
     WHERE room_id = $1 AND video_id IS NOT NULL`,
    [roomId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    videoId: row.video_id,
    isPlaying: row.is_playing,
    position: Number(row.position),
  };
}

// video_id match karna zaroori hai: purani movie ka event nayi movie ki state kharab na kare
async function applyPlayerUpdate(roomId, videoId, { isPlaying, position }) {
  const result = await pool.query(
    `UPDATE watch_sessions
     SET is_playing = $3, position_seconds = $4, updated_at = NOW()
     WHERE room_id = $1 AND video_id = $2
     RETURNING video_id`,
    [roomId, videoId, isPlaying, position]
  );
  return result.rows.length > 0;
}

// Room khali ho jaye to movie ko wahin pause kar do, warna database mein "chalti" rehti
// aur agli baar koi aata to position movie ke end ke paar hoti
async function freezeSession(roomId) {
  await pool.query(
    `UPDATE watch_sessions
     SET position_seconds = CASE
           WHEN is_playing THEN position_seconds + EXTRACT(EPOCH FROM (NOW() - updated_at))
           ELSE position_seconds
         END,
         is_playing = false,
         updated_at = NOW()
     WHERE room_id = $1`,
    [roomId]
  );
}

module.exports = { getPlayerState, applyPlayerUpdate, freezeSession };