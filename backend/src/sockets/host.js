const pool = require('../config/db');
const { freezeSession } = require('../services/player.service');

// getRoom() har baar abhi ka room dekar jata hai: { roomCode, roomId, hostId }
function registerHostHandlers(io, socket, getRoom) {
  // Har host action ka PEHLA kaam: pakka karo ki bhejne wala is room ka host hai.
  // Ye server par hota hai, isliye koi member DevTools se button dikha kar bhi kuch nahi kar sakta.
  function requireHost() {
    const room = getRoom();
    if (!room.roomId) return null;
    if (room.hostId !== socket.user.id) {
      socket.emit('room:error', 'Only the host can do this');
      return null;
    }
    return room;
  }

  // ---------- Chat on / off ----------
  socket.on('host:set-chat', async (data) => {
    try {
      const room = requireHost();
      if (!room) return;

      const enabled = data?.enabled === true;
      await pool.query('UPDATE rooms SET chat_enabled = $2 WHERE id = $1', [room.roomId, enabled]);
      io.to(room.roomCode).emit('room:chat-status', { enabled });
    } catch (err) {
      socket.emit('room:error', 'Could not change the chat setting');
    }
  });

  // ---------- Mute: ek member ka (userId) ya sabka (all) ----------
  // Ye sirf unke browser ko "mic band karo" ka hukm bhejta hai (server mic ko chhoo nahi sakta)
  socket.on('host:mute', async (data) => {
    try {
      const room = requireHost();
      if (!room) return;

      const sockets = await io.in(room.roomCode).fetchSockets();
      const targetId = Number(data?.userId);

      const targets = sockets.filter((s) => {
        if (s.user.id === room.hostId) return false; // host khud ko mute nahi karta
        return data?.all === true || s.user.id === targetId;
      });

      targets.forEach((s) => s.emit('host:muted', { by: socket.user.name }));
    } catch (err) {
      socket.emit('room:error', 'Could not mute');
    }
  });

  // ---------- Member ko nikalna (aur dobara aane se rokna) ----------
  socket.on('host:kick', async (data) => {
    try {
      const room = requireHost();
      if (!room) return;

      const targetId = Number(data?.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) return;
      if (targetId === room.hostId) return; // host ko kabhi nahi nikal sakte

      // Transaction: membership hatao aur ban likho, dono ek saath ya koi nahi
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [room.roomId, targetId]);
        await client.query(
          'INSERT INTO room_bans (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [room.roomId, targetId]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Us user ke saare tabs/sockets ko batao aur connection tod do
      // (emit ke baad disconnect safe hai, packet pehle bhej diya jata hai)
      const sockets = await io.in(room.roomCode).fetchSockets();
      sockets
        .filter((s) => s.user.id === targetId)
        .forEach((s) => {
          s.emit('room:kicked');
          s.disconnect(true);
        });

      // Baaki sabki member list se hatao
      io.to(room.roomCode).emit('room:member-removed', { userId: targetId });
    } catch (err) {
      socket.emit('room:error', 'Could not remove the member');
    }
  });

  // ---------- Room band karna ----------
  socket.on('host:end-room', async () => {
    try {
      const room = requireHost();
      if (!room) return;

      await pool.query("UPDATE rooms SET status = 'closed' WHERE id = $1", [room.roomId]);
      await freezeSession(room.roomId);

      const sockets = await io.in(room.roomCode).fetchSockets();
      sockets.forEach((s) => {
        s.emit('room:closed');
        s.disconnect(true);
      });
    } catch (err) {
      socket.emit('room:error', 'Could not end the room');
    }
  });
}

module.exports = { registerHostHandlers };