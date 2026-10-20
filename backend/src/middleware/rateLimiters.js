const rateLimit = require('express-rate-limit');

function makeLimiter({ windowMs, limit, message, keyGenerator, skip }) {
  const options = {
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  };
  if (keyGenerator) options.keyGenerator = keyGenerator;
  if (skip) options.skip = skip;
  return rateLimit(options);
}

// Login ke baad wale routes mein user ki id se gino (IP se nahi): ek wifi par kai log hon to ek-doosre ko na rokein
const byUser = (req) => String(req.user.id);

// Login, OTP, register, forgot password: ek IP se 15 min mein 50
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 50,
  message: 'Too many requests. Please try again later.',
});

// Poori API par moti si chhat: ek IP se 1 min mein 300.
// Video stream chhoda hai, kyunki seek karne par browser bahut chhoti requests bhejta hai
const apiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many requests. Please slow down.',
  skip: (req) => req.path.startsWith('/videos/'),
});

// Room code ka andaza lagana rokne ke liye
const joinLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many join attempts. Please wait a few minutes.',
  keyGenerator: byUser,
});

const createRoomLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: 'You created too many rooms. Please try again later.',
  keyGenerator: byUser,
});

// Upload sabse bhaari kaam hai (disk, CPU, ffmpeg)
const uploadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  message: 'Too many uploads. Please wait a few minutes.',
  keyGenerator: byUser,
});

module.exports = { authLimiter, apiLimiter, joinLimiter, createRoomLimiter, uploadLimiter };