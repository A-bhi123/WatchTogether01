// Har test file sabse pehle isko require karti hai (aur kisi bhi src/ file se PEHLE).
// Ye test ke liye settings, test database, aur OTP email ka nakli (stub) version lagata hai.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in backend/.env, so the test database name cannot be worked out');
  }
  const url = new URL(process.env.DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url.toString();
}

const url = testDatabaseUrl();
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));

// Safety: tests kabhi asli (development) database par nahi chalenge
if (!/_test$/.test(dbName)) {
  throw new Error(`Refusing to run: database "${dbName}" does not end with "_test"`);
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'test-jwt-secret-only-for-automated-tests-0123456789';
process.env.MESSAGE_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.MAX_ROOM_MEMBERS = '3'; // chhota, taaki "room full" jaldi test ho
process.env.AUTH_RATE_LIMIT = '1000'; // tests bahut login karte hain, limit yahan nahi test karte

// OTP email asli mein na jaye: yahin pakad lo (controllers ye function load hote waqt hi utha lete hain)
const emailService = require('../../src/services/email.service');
const sentOtps = [];
emailService.sendOtpEmail = async (to, otp, purpose) => {
  sentOtps.push({ to, otp, purpose });
};

function lastOtpFor(email) {
  const mine = sentOtps.filter((item) => item.to === email);
  return mine.length ? mine[mine.length - 1].otp : null;
}

module.exports = { lastOtpFor, TRUSTED_ORIGIN: process.env.FRONTEND_URL };