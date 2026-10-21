const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// Uptime monitor ke liye: server aur database dono theek hon to 200, warna 503.
// Jaan-bujhkar kam batata hai (koi version, time ya error text nahi), kyunki ye bina login ke khula hai.
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[health] database check failed:', err.code || err.message);
    res.status(503).json({ status: 'unavailable' });
  }
});

module.exports = router;