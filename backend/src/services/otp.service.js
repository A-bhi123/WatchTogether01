const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const OTP_EXPIRY_MINUTES = 2;
const MAX_ATTEMPTS = 5; // ek OTP par
const MAX_ATTEMPTS_PER_HOUR = 15; // ek ghante mein saare OTP milakar
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_OTPS_PER_HOUR = 10;

// Naya OTP banata hai, purane unused OTPs ko invalid kar deta hai
async function createOtp(userId, purpose) {
  await pool.query(
    `UPDATE otp_verifications SET expires_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL AND expires_at > NOW()`,
    [userId, purpose]
  );

  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = await bcrypt.hash(otp, 10);

  await pool.query(
    `INSERT INTO otp_verifications (user_id, otp_hash, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [userId, otpHash, purpose, OTP_EXPIRY_MINUTES]
  );

  return { otp, expiresInSeconds: OTP_EXPIRY_MINUTES * 60 };
}

// Resend cooldown + ghante mein max OTP limit
async function checkOtpRequestAllowed(userId, purpose) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at > NOW() - interval '1 hour') AS last_hour,
       EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) AS seconds_since_last
     FROM otp_verifications
     WHERE user_id = $1 AND purpose = $2`,
    [userId, purpose]
  );
  const row = result.rows[0];

  if (Number(row.last_hour) >= MAX_OTPS_PER_HOUR) {
    return { allowed: false, error: 'Too many OTP requests. Please try again after some time.' };
  }
  if (row.seconds_since_last !== null && Number(row.seconds_since_last) < RESEND_COOLDOWN_SECONDS) {
    const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - Number(row.seconds_since_last));
    return { allowed: false, error: `Please wait ${wait} seconds before requesting a new OTP.` };
  }
  return { allowed: true };
}

// Page ko batane ke liye: abhi wale OTP mein kitna samay, kitni koshish aur resend kab tak band hai.
// Saara hisaab database ki apni clock se, isliye browser ki clock ya refresh se koi farak nahi
async function getOtpStatus(userId, purpose) {
  const result = await pool.query(
    `SELECT GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW()))) AS expires_in,
            GREATEST(0, $3::numeric - EXTRACT(EPOCH FROM (NOW() - created_at))) AS resend_in,
            attempts
     FROM otp_verifications
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose, RESEND_COOLDOWN_SECONDS]
  );

  if (result.rows.length === 0) {
    return { exists: false, expiresInSeconds: 0, resendInSeconds: 0, attemptsLeft: 0 };
  }

  const row = result.rows[0];
  return {
    exists: true,
    expiresInSeconds: Math.ceil(Number(row.expires_in)),
    resendInSeconds: Math.ceil(Number(row.resend_in)),
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts),
  };
}

async function verifyOtp(userId, purpose, otp) {
  // Pichhle ghante mein saare OTP par kul galat koshishein bahut ho gayi to aur guess karne hi mat do
  // (warna nayi OTP mangwa-mangwa kar 5-5 guess lagaye ja sakte the)
  const totals = await pool.query(
    `SELECT COALESCE(SUM(attempts), 0)::int AS total
     FROM otp_verifications
     WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - interval '1 hour'`,
    [userId, purpose]
  );
  if (totals.rows[0].total >= MAX_ATTEMPTS_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      code: 'TOO_MANY_ATTEMPTS',
      error: 'Too many incorrect codes. Please try again in an hour.',
    };
  }

  const result = await pool.query(
    `SELECT id, otp_hash, attempts, (expires_at > NOW()) AS is_valid
     FROM otp_verifications
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose]
  );

  if (result.rows.length === 0) {
    return { ok: false, status: 400, code: 'NO_OTP', error: 'No active OTP found. Please request a new one.' };
  }
  const record = result.rows[0];

  if (!record.is_valid) {
    return { ok: false, status: 400, code: 'EXPIRED', error: 'OTP has expired. Please request a new one.' };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      code: 'TOO_MANY_ATTEMPTS',
      error: 'Too many wrong attempts. Please request a new OTP.',
    };
  }

  const isMatch = await bcrypt.compare(otp, record.otp_hash);
  if (!isMatch) {
    await pool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    const left = MAX_ATTEMPTS - record.attempts - 1;
    return { ok: false, status: 400, code: 'WRONG_OTP', error: `Incorrect OTP. ${left} attempts left.` };
  }

  await pool.query('UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1', [record.id]);
  return { ok: true };
}

module.exports = { createOtp, checkOtpRequestAllowed, getOtpStatus, verifyOtp, OTP_EXPIRY_MINUTES };