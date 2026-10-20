// WebRTC signaling: server sirf "dak-khana" hai. Video/awaaz kabhi server se nahi guzarti.

const DEFAULT_MEDIA = { camera: false, mic: false, screen: false, screenStreamId: null };

// Kis room mein kaun (socket id) abhi screen share kar raha hai. Ek waqt mein ek hi.
const screenSharers = new Map();

function peerInfo(s) {
  return {
    socketId: s.id,
    userId: s.user.id,
    name: s.user.name,
    media: s.data.media || { ...DEFAULT_MEDIA },
  };
}

function isValidSignal(data) {
  if (!data || typeof data !== 'object') return false;

  if (data.description) {
    const { type, sdp } = data.description;
    return (type === 'offer' || type === 'answer') && typeof sdp === 'string' && sdp.length < 100000;
  }
  if (data.candidate) {
    return typeof data.candidate === 'object' && JSON.stringify(data.candidate).length < 5000;
  }
  return false;
}

// Naya banda room mein aaya: use baaki sabki list do, baaki sabko uski khabar do
async function announceJoin(io, socket, roomCode) {
  socket.data.media = { ...DEFAULT_MEDIA };

  const socketsInRoom = await io.in(roomCode).fetchSockets();
  const peers = socketsInRoom.filter((s) => s.id !== socket.id).map(peerInfo);

  socket.emit('rtc:peers', peers);
  socket.to(roomCode).emit('rtc:peer-joined', peerInfo(socket));
}

function announceLeave(socket, roomCode) {
  // Share karne wala nikal gaya to jagah khali karo, taaki koi aur share kar sake
  if (screenSharers.get(roomCode) === socket.id) screenSharers.delete(roomCode);
  socket.to(roomCode).emit('rtc:peer-left', { socketId: socket.id });
}

function registerRtcHandlers(io, socket, getRoomCode) {
  // Ek peer ki chitthi doosre peer tak pahunchao
  socket.on('rtc:signal', (payload) => {
    const roomCode = getRoomCode();
    if (!roomCode) return;

    const to = payload?.to;
    const data = payload?.data;
    if (typeof to !== 'string' || !isValidSignal(data)) return;

    // Authorization: chitthi sirf usi room ke kisi doosre banda ko ja sakti hai
    const target = io.sockets.sockets.get(to);
    if (!target || target.id === socket.id || !target.rooms.has(roomCode)) return;

    target.emit('rtc:signal', { from: socket.id, data });
  });

  // Camera / mic / screen share ki khabar. Sirf wahi field badlegi jo bheji gayi
  socket.on('media:update', (data) => {
    const roomCode = getRoomCode();
    if (!roomCode) return;

    const next = { ...(socket.data.media || DEFAULT_MEDIA) };
    if (typeof data?.camera === 'boolean') next.camera = data.camera;
    if (typeof data?.mic === 'boolean') next.mic = data.mic;

    if (data?.screen === true) {
      // Koi aur pehle se share kar raha ho to mana kar do
      const holderId = screenSharers.get(roomCode);
      const holder = holderId && holderId !== socket.id ? io.sockets.sockets.get(holderId) : null;
      if (holder && holder.rooms.has(roomCode)) {
        socket.emit('screen:denied', { by: holder.user.name });
        return;
      }
      screenSharers.set(roomCode, socket.id);
      next.screen = true;
      next.screenStreamId = typeof data.screenStreamId === 'string' ? data.screenStreamId.slice(0, 100) : null;
    } else if (data?.screen === false) {
      if (screenSharers.get(roomCode) === socket.id) screenSharers.delete(roomCode);
      next.screen = false;
      next.screenStreamId = null;
    }

    socket.data.media = next;
    socket.to(roomCode).emit('media:state', { socketId: socket.id, media: next });
  });
}

module.exports = { announceJoin, announceLeave, registerRtcHandlers };