require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage: node scripts/runSql.js <file.sql | "SQL text">');
    process.exit(1);
  }
  const sql = arg.endsWith('.sql') ? fs.readFileSync(path.resolve(arg), 'utf8') : arg;
  const result = await pool.query(sql);
  console.log(result.rows && result.rows.length ? result.rows : 'Done.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('SQL failed:', err.message);
  await pool.end();
  process.exit(1);
});