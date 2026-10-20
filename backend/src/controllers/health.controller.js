const pool = require('../config/db');

async function getHealth(req, res) {
  res.json({ status: 'ok', message: 'Backend is running' });
}

async function getDbCheck(req, res, next) {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ dbTime: result.rows[0].now });
  } catch (err) {
    next(err); // pass error to centralized error handler
  }
}

module.exports = { getHealth, getDbCheck };