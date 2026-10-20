const { assertEnv } = require('./config/env');
assertEnv(); // pehle settings jaanch lo, galat hon to yahin ruk jao

const pool = require('./config/db');
const mediaService = require('./services/media.service');
const { createServer } = require('./createServer');

const PORT = process.env.PORT || 5000;
const { server } = createServer();

// Shuru hote hi dekh lo ki database mil raha hai ya nahi
async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log('[db] PostgreSQL: OK');
  } catch (err) {
    console.error(
      `[db] PostgreSQL: UNAVAILABLE (${err.code || err.message}). The API will answer 503 until it is back.`
    );
  }
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  checkDatabase();

  // Sirf jaankari ke liye hai: ye na chale to bhi server band nahi hona chahiye
  Promise.resolve()
    .then(() => mediaService.logMediaToolStatus?.())
    .catch((err) => console.warn('[media] could not report ffmpeg status:', err.message));
});

// Kahin koi async galti pakdi na gayi ho to bhi chup-chaap na jaye
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Isme programme ki halat bharose layak nahi rehti, isliye log karke band kar dete hain.
// (Production mein process manager use band hone par khud dobara chalu karta hai, Phase 26)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});