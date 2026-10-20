// Test database banata hai: apni development database ki COPY (sirf structure), phir saara data saaf.
// Isse tests hamesha bilkul asli schema par chalte hain, migrations dobara chalane ki zaroorat nahi.
//
//   npm run test:setup            test database banao (ya naye sire se)
//   npm run test:setup -- --kick  agar backend/pgAdmin connected hai to unke connections tod kar banao
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const SAFE_NAME = /^[A-Za-z0-9_]+$/;

function plan() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing in backend/.env');

  const devUrl = new URL(process.env.DATABASE_URL);
  const devName = decodeURIComponent(devUrl.pathname.slice(1));

  const testUrl = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) testUrl.pathname = `/${devName}_test`;
  const testName = decodeURIComponent(testUrl.pathname.slice(1));

  // Ye naam SQL mein seedha likhe jate hain (database ka naam $1 se nahi bhej sakte), isliye sakht jaanch
  if (!SAFE_NAME.test(devName) || !SAFE_NAME.test(testName)) {
    throw new Error('Database names may only contain letters, numbers and underscores');
  }
  if (!testName.endsWith('_test')) {
    throw new Error(`The test database name must end with "_test" (got "${testName}")`);
  }
  if (testName === devName) {
    throw new Error('The test database must be different from your development database');
  }

  const adminUrl = new URL(devUrl.toString());
  adminUrl.pathname = '/postgres'; // database banane/hatane ke liye kisi aur database se jurna padta hai
  return { devName, testName, testUrl, adminUrl };
}

async function main() {
  const { devName, testName, testUrl, adminUrl } = plan();
  const kick = process.argv.includes('--kick');

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Purani test database hatao, taaki naye sire se bane
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
    } catch (err) {
      if (err.code !== '42601') throw err; // PostgreSQL 13 se purane mein FORCE nahi hota
      await admin.query(`DROP DATABASE IF EXISTS "${testName}"`);
    }

    if (kick) {
      // Development backend / pgAdmin ke connections tod do (backend ka pool khud dobara jud jata hai)
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [devName]
      );
    }

    try {
      await admin.query(`CREATE DATABASE "${testName}" TEMPLATE "${devName}"`);
    } catch (err) {
      if (err.code === '55006') {
        console.error(`"${devName}" is in use, and PostgreSQL cannot copy a database that someone is connected to.`);
        console.error('Stop the backend (Ctrl+C) and close pgAdmin, then run this again.');
        console.error('Or let this script disconnect them for you:  npm run test:setup -- --kick');
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  } finally {
    await admin.end();
  }

  // Copy ke saath development ka data bhi aa gaya. Wo saaf karo: test database ko sirf structure chahiye
  const db = new Client({ connectionString: testUrl.toString() });
  await db.connect();
  try {
    const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    if (tables.rows.length > 0) {
      const list = tables.rows.map((row) => `"${row.tablename}"`).join(', ');
      await db.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
    console.log(`Test database "${testName}" is ready: ${tables.rows.length} tables, no data.`);
    console.log('Now run: npm test');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Could not set up the test database:', err.message);
    if (err.code === 'ECONNREFUSED') console.error('PostgreSQL is not running, or DATABASE_URL has the wrong host or port.');
    process.exit(1);
  });
}

module.exports = { plan };