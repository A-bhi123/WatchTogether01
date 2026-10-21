const crypto = require('crypto');

// STUN: browser ko batata hai ki wo internet par kis public address se dikhta hai (muft, Google ka).
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

// Har user ke liye ICE servers ki list banata hai.
// TURN ke liye "time-limited credentials" (TURN REST API) use hote hain: username = "expiry:userId",
// password = HMAC(secret, username). Secret kabhi browser tak nahi jata, aur credential kuch ghante mein
// expire ho jata hai, isliye koi use copy karke tumhara TURN bandwidth hamesha nahi kha sakta.
// Setting nahi di ho (jaise development mein) to sirf STUN milta hai.
function buildIceServers(userId, now = Date.now()) {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SECRET;
  if (!host || !secret) return STUN_SERVERS.map((server) => ({ ...server }));

  const port = process.env.TURN_PORT || 3478;
  const ttlSeconds = Number(process.env.TURN_TTL_SECONDS) || 24 * 60 * 60;

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return [
    ...STUN_SERVERS.map((server) => ({ ...server })),
    { urls: `stun:${host}:${port}` },
    {
      urls: [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`],
      username,
      credential,
    },
  ];
}

module.exports = { buildIceServers };