const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { createOtp, checkOtpRequestAllowed, verifyOtp, OTP_EXPIRY_MINUTES } = require('../services/otp.service');
const { sendOtpEmail } = require('../services/email.service');
const { isBlocked, recordFailure, clearFailures } = require('../utils/loginThrottle');

// User na mile tab bhi bcrypt chalate hain. Warna jawab jaldi aane se pata chal jata ki ye email registered nahi hai
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

// tv = token_version. User ka version badal jaye (password reset) to ye token chalna band
function setAuthCookie(res, userId, tokenVersion = 0) {
  const token = jwt.sign({ userId, type: 'auth', tv: tokenVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

// Password sahi hone ka proof: chhota pending-login cookie
function readPendingLogin(req) {
  const token = req.cookies.pending_login;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.type === 'login_otp' ? payload.userId : null;
  } catch {
    return null;
  }
}

async function sendLoginOtp(user) {
  const check = await checkOtpRequestAllowed(user.id, 'login');
  if (!check.allowed) return { error: check.error };

  const { otp, expiresInSeconds } = await createOtp(user.id, 'login');
  await sendOtpEmail(user.email, otp, 'login', OTP_EXPIRY_MINUTES);
  return { expiresInSeconds };
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Is IP se is email par bahut galat koshishein ho chuki hain
    const minutesLeft = isBlocked(req.ip, email);
    if (minutesLeft > 0) {
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`,
      });
    }

    const result = await pool.query(
      'SELECT id, name, email, password_hash, email_verified FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      recordFailure(req.ip, email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    clearFailures(req.ip, email);

    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Your email is not verified yet. Please create your account again to get a new verification OTP.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const sent = await sendLoginOtp(user);
    if (sent.error) {
      return res.status(429).json({ error: sent.error });
    }

    const pendingToken = jwt.sign({ userId: user.id, type: 'login_otp' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.cookie('pending_login', pendingToken, { ...cookieBase, maxAge: 10 * 60 * 1000 });

    res.json({
      otpRequired: true,
      maskedEmail: maskEmail(user.email),
      expiresInSeconds: sent.expiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
}

async function verifyLoginOtp(req, res, next) {
  try {
    const userId = readPendingLogin(req);
    if (!userId) {
      return res.status(401).json({ error: 'Login session expired. Please log in again.', code: 'LOGIN_EXPIRED' });
    }

    const { otp } = req.body || {};
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Enter the 6-digit OTP' });
    }

    const result = await verifyOtp(userId, 'login', otp);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    const userResult = await pool.query(
      'SELECT id, name, email, created_at, token_version FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Login session expired. Please log in again.', code: 'LOGIN_EXPIRED' });
    }

    const { token_version: tokenVersion, ...publicUser } = userResult.rows[0];

    res.clearCookie('pending_login', cookieBase);
    setAuthCookie(res, userId, tokenVersion);
    res.json({ user: publicUser });
  } catch (err) {
    next(err);
  }
}

async function resendLoginOtp(req, res, next) {
  try {
    const userId = readPendingLogin(req);
    if (!userId) {
      return res.status(401).json({ error: 'Login session expired. Please log in again.', code: 'LOGIN_EXPIRED' });
    }

    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Login session expired. Please log in again.', code: 'LOGIN_EXPIRED' });
    }

    const sent = await sendLoginOtp(user);
    if (sent.error) {
      return res.status(429).json({ error: sent.error });
    }

    res.json({ message: 'A new OTP has been sent', expiresInSeconds: sent.expiresInSeconds });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  res.clearCookie('token', cookieBase);
  res.clearCookie('pending_login', cookieBase);
  res.json({ message: 'Logged out' });
}

function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, verifyLoginOtp, resendLoginOtp, logout, me, cookieBase, maskEmail, setAuthCookie, readPendingLogin };