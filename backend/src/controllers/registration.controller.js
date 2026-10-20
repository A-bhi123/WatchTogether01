const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { createOtp, checkOtpRequestAllowed, verifyOtp, OTP_EXPIRY_MINUTES } = require('../services/otp.service');
const { sendOtpEmail } = require('../services/email.service');
const { cookieBase, maskEmail, setAuthCookie } = require('./session.controller');
const { validatePassword } = require('../utils/validators');

function readPendingRegister(req) {
  const token = req.cookies.pending_register;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.type === 'register_otp' ? payload.userId : null;
  } catch {
    return null;
  }
}

async function sendRegisterOtp(user) {
  const check = await checkOtpRequestAllowed(user.id, 'register');
  if (!check.allowed) return { error: check.error };

  const { otp, expiresInSeconds } = await createOtp(user.id, 'register');
  await sendOtpEmail(user.email, otp, 'account verification', OTP_EXPIRY_MINUTES);
  return { expiresInSeconds };
}

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (cleanName.length > 100) {
      return res.status(400).json({ error: 'Name is too long' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existing = await pool.query(
      'SELECT id, email_verified FROM users WHERE LOWER(email) = LOWER($1)',
      [cleanEmail]
    );
    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    if (existing.rows.length > 0) {
      if (existing.rows[0].email_verified) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      // Pehle register hua tha par verify nahi hua: naya data save karo, naya OTP bhejo
      const updated = await pool.query(
        'UPDATE users SET name = $1, password_hash = $2 WHERE id = $3 RETURNING id, name, email',
        [cleanName, passwordHash, existing.rows[0].id]
      );
      user = updated.rows[0];
    } else {
      const inserted = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [cleanName, cleanEmail, passwordHash]
      );
      user = inserted.rows[0];
    }

    const sent = await sendRegisterOtp(user);
    if (sent.error) {
      return res.status(429).json({ error: sent.error });
    }

    const pendingToken = jwt.sign({ userId: user.id, type: 'register_otp' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.cookie('pending_register', pendingToken, { ...cookieBase, maxAge: 10 * 60 * 1000 });

    res.status(201).json({
      otpRequired: true,
      purpose: 'register',
      maskedEmail: maskEmail(user.email),
      expiresInSeconds: sent.expiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
}

async function verifyRegisterOtp(req, res, next) {
  try {
    const userId = readPendingRegister(req);
    if (!userId) {
      return res.status(401).json({ error: 'Registration session expired. Please create your account again.', code: 'REGISTER_EXPIRED' });
    }

    const { otp } = req.body || {};
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Enter the 6-digit OTP' });
    }

    const result = await verifyOtp(userId, 'register', otp);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    const userResult = await pool.query(
      'UPDATE users SET email_verified = true WHERE id = $1 RETURNING id, name, email, created_at, token_version',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Registration session expired. Please create your account again.', code: 'REGISTER_EXPIRED' });
    }

    const { token_version: tokenVersion, ...publicUser } = userResult.rows[0];
    res.clearCookie('pending_register', cookieBase);
    setAuthCookie(res, userId, tokenVersion);
    res.json({ user: publicUser });
  } catch (err) {
    next(err);
  }
}

async function resendRegisterOtp(req, res, next) {
  try {
    const userId = readPendingRegister(req);
    if (!userId) {
      return res.status(401).json({ error: 'Registration session expired. Please create your account again.', code: 'REGISTER_EXPIRED' });
    }

    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND email_verified = false',
      [userId]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Registration session expired. Please create your account again.', code: 'REGISTER_EXPIRED' });
    }

    const sent = await sendRegisterOtp(user);
    if (sent.error) {
      return res.status(429).json({ error: sent.error });
    }

    res.json({ message: 'A new OTP has been sent', expiresInSeconds: sent.expiresInSeconds });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, verifyRegisterOtp, resendRegisterOtp, readPendingRegister };