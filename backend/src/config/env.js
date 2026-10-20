require('dotenv').config();

// Server shuru hone se pehle zaroori settings jaanch lo. Galat ya kamzor ho to chalne hi mat do.
function assertEnv() {
  const problems = [];

  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'MESSAGE_ENCRYPTION_KEY']) {
    if (!process.env[name]) problems.push(`${name} is missing in backend/.env`);
  }

  const secret = process.env.JWT_SECRET || '';
  if (secret && secret.length < 32) {
    problems.push('JWT_SECRET is too short (use at least 32 characters)');
  }
  if (secret && /your_secret|changeme|change_me|secret_here|generate-a|example/i.test(secret)) {
    problems.push('JWT_SECRET looks like a placeholder. Generate a real random one');
  }

  const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (frontend && !/^https?:\/\/[^/]+$/.test(frontend)) {
    problems.push('FRONTEND_URL must look like http://localhost:5173 (no path)');
  }
  if (process.env.NODE_ENV === 'production' && frontend && !frontend.startsWith('https://')) {
    problems.push('FRONTEND_URL must start with https:// in production');
  }

  if (problems.length > 0) {
    console.error('\n[config] The server cannot start:');
    problems.forEach((problem) => console.error(`  - ${problem}`));
    console.error('');
    process.exit(1);
  }
}

module.exports = { assertEnv };