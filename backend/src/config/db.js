const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Database na mile to 5 sec baad error, warna request hamesha latki rehti
  connectionTimeoutMillis: 5000,
});

// Zaroori: agar Postgres chalte backend ke beech band/restart ho jaye, to pool "error" event deta hai.
// Is par koi listener na ho to Node poora process crash kar deta hai.
pool.on('error', (err) => {
  console.error('[db] Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;