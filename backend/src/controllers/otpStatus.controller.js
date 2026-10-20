const pool = require('../config/db');
const { getOtpStatus } = require('../services/otp.service');
const { readPendingLogin, maskEmail } = require('./session.controller');
const { readPendingRegister } = require('./registration.controller');

// OTP page ye poochta hai: "mere abhi wale OTP mein kitne second bache?"
// Pending cookie chahiye (yani password pehle hi sahi daal chuke ho), isliye kisi aur ke liye kuch nahi batata
async function otpStatus(req, res, next) {
  try {
    const purpose = req.query.purpose;
    if (purpose !== 'login' && purpose !== 'register') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const expired = {
      error:
        purpose === 'register'
          ? 'Registration session expired. Please create your account again.'
          : 'Login session expired. Please log in again.',
      code: purpose === 'register' ? 'REGISTER_EXPIRED' : 'LOGIN_EXPIRED',
    };

    const userId = purpose === 'register' ? readPendingRegister(req) : readPendingLogin(req);
    if (!userId) return res.status(401).json(expired);

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(401).json(expired);

    const status = await getOtpStatus(userId, purpose);
    res.json({ maskedEmail: maskEmail(userResult.rows[0].email), ...status });
  } catch (err) {
    next(err);
  }
}

module.exports = { otpStatus };