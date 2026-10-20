// Har socket event par limit. Ek hi jagah (socket.use) se saare events ko cover karta hai.
const LIMITS = {
  'room:join': { max: 10, windowMs: 10000 },
  'chat:send': { max: 8, windowMs: 5000 },
  'chat:delete': { max: 10, windowMs: 10000 },
  'chat:clear': { max: 3, windowMs: 10000 },
  'typing:start': { max: 10, windowMs: 5000 },
  'typing:stop': { max: 10, windowMs: 5000 },
  'player:update': { max: 30, windowMs: 5000 },
  'player:request-state': { max: 12, windowMs: 5000 },
  'rtc:signal': { max: 300, windowMs: 10000 }, // ICE candidates ek saath bahut aate hain
  'media:update': { max: 20, windowMs: 10000 },
  'host:set-chat': { max: 10, windowMs: 10000 },
  'host:mute': { max: 20, windowMs: 10000 },
  'host:kick': { max: 10, windowMs: 10000 },
  'host:end-room': { max: 3, windowMs: 10000 },
};
const DEFAULT_LIMIT = { max: 60, windowMs: 10000 }; // jo event list mein nahi

function registerSocketRateLimits(socket) {
  const hits = new Map(); // event ka naam -> pichhle hits ka time
  let lastNoticeAt = 0;

  socket.use((packet, next) => {
    const event = packet[0];
    const limit = LIMITS[event] || DEFAULT_LIMIT;
    const now = Date.now();

    const recent = (hits.get(event) || []).filter((time) => now - time < limit.windowMs);

    if (recent.length >= limit.max) {
      hits.set(event, recent);
      // Event gira do (next() nahi bulaya). User ko 3 sec mein ek baar batao
      if (now - lastNoticeAt > 3000) {
        lastNoticeAt = now;
        socket.emit('room:error', 'You are doing that too fast. Please slow down.');
      }
      return;
    }

    recent.push(now);
    hits.set(event, recent);
    next();
  });
}

module.exports = { registerSocketRateLimits };