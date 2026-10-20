require('./env');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../src/config/db');

let counter = 0;
// Har test apna alag data banata hai (alag email, alag room), isliye tests ek-doosre se nahi takrate
function unique(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}${crypto.randomBytes(2).toString('hex')}`;
}

async function createUser({ password = 'Password1x', verified = true, name = 'Test User' } = {}) {
  const email = `${unique('u')}@example.test`;
  const hash = await bcrypt.hash(password, 4); // test mein kam cost, taaki tez chale
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, token_version`,
    [name, email, hash, verified]
  );
  return { ...result.rows[0], password };
}

function tokenFor(user, tokenVersion = user.token_version) {
  return jwt.sign({ userId: user.id, type: 'auth', tv: tokenVersion }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// "Cookie" header ki value: login kiye bina seedha logged-in user ban jao
function authCookie(user) {
  return `token=${tokenFor(user)}`;
}

async function createRoomRow(host, { name = 'Test Room' } = {}) {
  const code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  const room = await pool.query(
    `INSERT INTO rooms (room_code, name, host_id, status) VALUES ($1, $2, $3, 'active')
     RETURNING id, room_code`,
    [code, name, host.id]
  );
  await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.rows[0].id, host.id]);
  return { id: room.rows[0].id, code: room.rows[0].room_code };
}

async function addMember(room, user) {
  await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, user.id]);
}

// Ek hi value wali query ka jawab (jaise COUNT)
async function scalar(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] ? Object.values(result.rows[0])[0] : null;
}

module.exports = { pool, unique, createUser, tokenFor, authCookie, createRoomRow, addMember, scalar };