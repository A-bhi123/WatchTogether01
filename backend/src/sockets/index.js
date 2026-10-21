const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const pool = require('../config/db');
const { assertKeyConfigured, encryptMessage } = require('../services/crypto.service');
const { getPlayerState, applyPlayerUpdate, freezeSession } = require('../services/player.service');
const { announceJoin, announceLeave, registerRtcHandlers } = require('./rtc');
const { registerHostHandlers } = require('./host');
const { registerSocketRateLimits } = require('./rateLimit');
const { buildIceServers } = require('../services/turn.service');
// Frontend ke DELETE_WINDOW_HOURS jaisa hi rakho
const DELETE_FOR_EVERYONE_HOURS = 60;
const PLAYER_REASONS = ['play', 'pause', 'seek'];

// Ek room ke playback events line se (ek ke baad ek) chalte hain, taaki
// database aur broadcast dono mein wahi order rahe jis order mein events aaye
const roomQueues = new Map();
function runInRoomQueue(roomId, task) {
  const previous = roomQueues.get(roomId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  roomQueues.set(roomId, next);
  next
    .finally(() => {
      if (roomQueues.get(roomId) === next) roomQueues.delete(roomId);
    })
    .catch(() => {});
  return next;
}

function cleanIds(rawIds) {
  const list = Array.isArray(rawIds) ? rawIds : [];
  return [...new Set(list.map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0 && id < 2147483648)
    .slice(0, 100);
}

function initSockets(io) {
  assertKeyConfigured(); // key missing ho to server start hote hi saaf error aayega

  // Har naye socket connection par JWT cookie verify karo
  io.use(async (socket, next) => {
    try {
      const rawCookies = socket.handshake.headers.cookie;
      if (!rawCookies) return next(new Error('Not authenticated'));

      const parsed = cookie.parse(rawCookies);
      const token = parsed.token;
      if (!token) return next(new Error('Not authenticated'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== 'auth') return next(new Error('Invalid session'));

      const result = await pool.query(
        'SELECT id, name, email, token_version FROM users WHERE id = $1',
        [payload.userId]
      );
      if (result.rows.length === 0) return next(new Error('User no longer exists'));

      // Password reset ke baad purane token se socket bhi nahi khulega
      if ((payload.tv ?? 0) !== result.rows[0].token_version) return next(new Error('Not authenticated'));

      socket.user = { id: result.rows[0].id, name: result.rows[0].name, email: result.rows[0].email };
      next();
    } catch {
      next(new Error('Not authenticated'));
    }
  });

  io.on('connection', (socket) => {
    let currentRoomCode = null;
    let currentRoomId = null;
    let currentHostId = null;
    registerSocketRateLimits(socket); // socket events par flood limit
    // Har connection par taaza STUN/TURN list (TURN ke credentials user ke hisaab se, kuch ghante mein expire)
    socket.emit('rtc:ice-servers', buildIceServers(socket.user.id));
    registerRtcHandlers(io, socket, () => currentRoomCode);
    registerHostHandlers(io, socket, () => ({
      roomCode: currentRoomCode,
      roomId: currentRoomId,
      hostId: currentHostId,
    }));

    function broadcastTyping(isTyping) {
      if (!currentRoomCode) return;
      socket.to(currentRoomCode).emit('typing:update', {
        id: socket.user.id,
        name: socket.user.name,
        isTyping,
      });
    }

    socket.on('room:join', async (rawCode) => {
      try {
        const roomCode = String(rawCode || '').toUpperCase();

        const roomResult = await pool.query(
          'SELECT id, host_id FROM rooms WHERE room_code = $1',
          [roomCode]
        );
        if (roomResult.rows.length === 0) {
          return socket.emit('room:error', 'Room not found');
        }
        const roomId = roomResult.rows[0].id;

        const memberCheck = await pool.query(
          'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, socket.user.id]
        );
        if (memberCheck.rows.length === 0) {
          return socket.emit('room:error', 'You are not a member of this room');
        }

        socket.join(roomCode);
        currentRoomCode = roomCode;
        currentRoomId = roomId;
        currentHostId = roomResult.rows[0].host_id;

        socket.to(roomCode).emit('room:user-joined', { id: socket.user.id, name: socket.user.name });

        const socketsInRoom = await io.in(roomCode).fetchSockets();
        const onlineUsers = socketsInRoom.map((s) => ({ id: s.user.id, name: s.user.name }));
        socket.emit('room:online-users', onlineUsers);
        await announceJoin(io, socket, roomCode);
      } catch (err) {
        socket.emit('room:error', 'Could not join room');
      }
    });

    socket.on('chat:send', async (data) => {
      try {
        if (!currentRoomId) return;

        const text = typeof data?.message === 'string' ? data.message.trim() : '';
        if (!text || text.length > 1000) return;

        // Room band ho gaya ho, ya host ne chat disable ki ho (host khud phir bhi bhej sakta hai)
        const settings = await pool.query('SELECT chat_enabled, status FROM rooms WHERE id = $1', [currentRoomId]);
        const roomRow = settings.rows[0];
        if (!roomRow || roomRow.status !== 'active') {
          return socket.emit('chat:error', 'This room has ended.');
        }
        if (!roomRow.chat_enabled && currentHostId !== socket.user.id) {
          return socket.emit('chat:error', 'Chat is disabled by the host.');
        }
        
        // Database mein sirf encrypted text jata hai
        const inserted = await pool.query(
          `INSERT INTO messages (room_id, user_id, message) VALUES ($1, $2, $3)
           RETURNING id, created_at`,
          [currentRoomId, socket.user.id, encryptMessage(text)]
        );

        const payload = {
          id: inserted.rows[0].id,
          message: text,
          created_at: inserted.rows[0].created_at,
          is_deleted: false,
          deleted_by: null,
          deleted_by_name: null,
          user_id: socket.user.id,
          user_name: socket.user.name,
        };

        io.to(currentRoomCode).emit('chat:message', payload);
      } catch (err) {
        socket.emit('chat:error', 'Could not send message');
      }
    });

    // scope: 'me' (sirf mere liye) ya 'everyone' (sabke liye)
    socket.on('chat:delete', async (data) => {
      try {
        if (!currentRoomId) return;

        const messageIds = cleanIds(data?.messageIds);
        if (messageIds.length === 0) return;

        if (data?.scope === 'me') {
          // Delete for me: sirf is user ke liye chhupao (message_hidden mein record)
          await pool.query(
            `INSERT INTO message_hidden (user_id, message_id)
             SELECT $2::int, m.id FROM messages m
             WHERE m.id = ANY($1::int[]) AND m.room_id = $3
             ON CONFLICT DO NOTHING`,
            [messageIds, socket.user.id, currentRoomId]
          );
          return;
        }

        if (data?.scope !== 'everyone') return;

        // Authorization: apna message 60 ghante ke andar, YA host (koi bhi message)
        const isHost = currentHostId === socket.user.id;
        const result = await pool.query(
          `UPDATE messages SET deleted_at = NOW(), deleted_by = $2, message = ''
           WHERE id = ANY($1::int[])
             AND room_id = $3
             AND deleted_at IS NULL
             AND (
               (user_id = $2 AND created_at > NOW() - make_interval(hours => $4))
               OR $5::boolean
             )
           RETURNING id`,
          [messageIds, socket.user.id, currentRoomId, DELETE_FOR_EVERYONE_HOURS, isHost]
        );

        const deletedIds = result.rows.map((row) => row.id);
        if (deletedIds.length > 0) {
          io.to(currentRoomCode).emit('chat:deleted', {
            ids: deletedIds,
            deletedBy: { id: socket.user.id, name: socket.user.name },
          });
        }
        if (deletedIds.length < messageIds.length) {
          socket.emit(
            'chat:error',
            isHost
              ? 'Some messages were already deleted.'
              : `You can delete for everyone only your own messages from the last ${DELETE_FOR_EVERYONE_HOURS} hours.`
          );
        }
      } catch (err) {
        socket.emit('chat:error', 'Could not delete messages');
      }
    });

    // Clear chat: sirf is user ke liye, doosron par koi asar nahi
    socket.on('chat:clear', async () => {
      try {
        if (!currentRoomId) return;
        await pool.query(
          'UPDATE room_members SET chat_cleared_at = NOW() WHERE room_id = $1 AND user_id = $2',
          [currentRoomId, socket.user.id]
        );
        socket.emit('chat:cleared');
      } catch (err) {
        socket.emit('chat:error', 'Could not clear chat');
      }
    });

    // Koi bhi member abhi ki playback state maang sakta hai (join par aur har 5 sec mein)
    socket.on('player:request-state', async () => {
      try {
        if (!currentRoomId) return;
        const state = await getPlayerState(currentRoomId);
        if (state) socket.emit('player:state', { ...state, reason: 'sync' });
      } catch (err) {
        socket.emit('room:error', 'Could not load playback state');
      }
    });

    // Room ka KOI BHI member: play / pause / seek
    socket.on('player:update', (data) => {
      if (!currentRoomId) return;
      const roomId = currentRoomId;
      const roomCode = currentRoomCode;

      runInRoomQueue(roomId, async () => {
        const videoId = Number(data?.videoId);
        const position = Number(data?.position);
        const reason = data?.reason;
        const isPlaying = data?.isPlaying === true;

        if (!Number.isInteger(videoId) || videoId <= 0) return;
        if (!Number.isFinite(position) || position < 0 || position > 10000000) return;
        if (!PLAYER_REASONS.includes(reason)) return;

        const saved = await applyPlayerUpdate(roomId, videoId, { isPlaying, position });
        if (!saved) return; // ye us movie ka event hai jo ab room ki active movie nahi

        // Sender ko wapas nahi bhejte (socket.to), isse echo loop nahi banta
        socket.to(roomCode).emit('player:state', {
          videoId,
          isPlaying,
          position,
          reason,
          by: socket.user.name,
        });
      }).catch(() => socket.emit('room:error', 'Could not update playback'));
    });

    socket.on('typing:start', () => broadcastTyping(true));
    socket.on('typing:stop', () => broadcastTyping(false));

    socket.on('disconnect', async () => {
      if (!currentRoomCode) return;

      broadcastTyping(false);
      announceLeave(socket, currentRoomCode);
      socket.to(currentRoomCode).emit('room:user-left', { id: socket.user.id, name: socket.user.name });

      try {
        // Room mein koi nahi bacha to movie ko pause kar do
        const remaining = await io.in(currentRoomCode).fetchSockets();
        if (remaining.length === 0) await freezeSession(currentRoomId);
      } catch {
        // koi baat nahi, agli baar sync ho jayega
      }
    });
  });
}

module.exports = initSockets;