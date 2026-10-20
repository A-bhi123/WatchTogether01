const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { createOtp, checkOtpRequestAllowed, verifyOtp, OTP_EXPIRY_MINUTES } = require('../services/otp.service');
const { sendOtpEmail } = require('../services/email.service');
const { validatePassword } = require('../utils/validators');

const GENERIC_MESSAGE = 'If that email is registered, an OTP has been sent.';

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await pool.query('SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    const user = result.rows[0];

    if (user) {
      try {
        // Cooldown (30 sec) aur ghante ki limit yahan bhi lagti hai
        const check = await checkOtpRequestAllowed(user.id, 'password_reset');
        if (check.allowed) {
          const { otp } = await createOtp(user.id, 'password_reset');
          await sendOtpEmail(user.email, otp, 'password reset', OTP_EXPIRY_MINUTES);
        }
      } catch (err) {
        // Email nahi gayi to bhi jawab wahi: warna "is email par jawab alag aaya" se pata chal jata ki wo registered hai
        console.error('Could not send password reset OTP:', err.message);
      }
    }

    // Email mile ya na mile, jawab bilkul ek jaisa
    res.json({ message: GENERIC_MESSAGE });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (typeof email !== 'string' || typeof otp !== 'string' || typeof newPassword !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email, OTP and new password are required' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Enter the 6-digit OTP' });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (userResult.rows.length === 0) {
      // Wahi jawab jo "is user ka koi OTP nahi" par aata hai, taaki email ka pata na chale
      return res.status(400).json({ error: 'No active OTP found. Please request a new one.', code: 'NO_OTP' });
    }
    const userId = userResult.rows[0].id;

    const result = await verifyOtp(userId, 'password_reset', otp);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    // token_version badhane se is user ke purane SAARE login (chori hue bhi) turant bekaar ho jate hain
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [newHash, userId]
    );

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { forgotPassword, resetPassword };