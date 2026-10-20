const { TRUSTED_ORIGIN } = require('./helpers/env'); // sabse pehle
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { pool, createUser, authCookie, scalar } = require('./helpers/db');

after(() => pool.end());

// errorHandler har error log karta hai. Jin tests mein error jaan-bujhkar aata hai wahan log ka shor band
async function quietly(run) {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

describe('security headers', () => {
  it('sends helmet headers and hides the framework name', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-site');
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});

describe('cross-site request protection (Origin check)', () => {
  it('blocks a POST that comes from another website', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'http://evil.example');
    assert.equal(res.status, 403);
    assert.match(res.body.error, /untrusted origin/i);
  });

  it('allows our own website, and tools that send no Origin at all', async () => {
    assert.equal((await request(app).post('/api/auth/logout').set('Origin', TRUSTED_ORIGIN)).status, 200);
    assert.equal((await request(app).post('/api/auth/logout')).status, 200);
  });
});

describe('bad input and unknown routes', () => {
  it('broken JSON gives a clean 400', async () => {
    const res = await quietly(() =>
      request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad')
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid request data.');
  });

  it('an unknown API route gives a clean 404', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  });

  it('login with the wrong data types is a 400, not a crash', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: '' }, password: ['x'] });
    assert.equal(res.status, 400);
  });
});

describe('errors never leak internals', () => {
  // pool.query ko kuch der ke liye toota hua bana deta hai (asli database band kiye bina)
  async function withBrokenDatabase(error, run) {
    pool.query = async () => {
      throw error;
    };
    try {
      return await quietly(run);
    } finally {
      delete pool.query; // asli query wapas
    }
  }

  it('an unexpected database error becomes a generic 500', async () => {
    const user = await createUser();
    const secret = new Error('connection string postgres://admin:SuperSecret@10.0.0.5/prod failed');

    const res = await withBrokenDatabase(secret, () =>
      request(app).get('/api/auth/me').set('Cookie', authCookie(user))
    );
    assert.equal(res.status, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /SuperSecret|postgres:|10\.0\.0\.5/);
  });

  it('a database that is down becomes a friendly 503', async () => {
    const user = await createUser();
    const down = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

    const res = await withBrokenDatabase(down, () =>
      request(app).get('/api/auth/me').set('Cookie', authCookie(user))
    );
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'DB_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(res.body), /ECONNREFUSED|127\.0\.0\.1/);
  });
});

describe('SQL injection attempts are only ever treated as data', () => {
  it('a classic login injection is just a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: `' OR '1'='1' --`, password: 'x' });
    assert.equal(res.status, 401);
  });

  it('a room code that tries to drop a table does nothing', async () => {
    const user = await createUser();
    const evil = encodeURIComponent(`X'; DROP TABLE users; --`);

    const res = await request(app).get(`/api/rooms/${evil}`).set('Cookie', authCookie(user));
    assert.equal(res.status, 404);
    assert.ok((await scalar('SELECT COUNT(*)::int FROM users')) >= 1); // users table zinda hai
  });
});

describe('brute force protection', () => {
  it('5 wrong passwords lock that email on this IP, even for the right password', async () => {
    const user = await createUser();
    const login = (password) => request(app).post('/api/auth/login').send({ email: user.email, password });

    for (let i = 0; i < 5; i++) assert.equal((await login('WrongPass99')).status, 401);

    const locked = await login(user.password);
    assert.equal(locked.status, 429);
    assert.match(locked.body.error, /too many failed attempts/i);
  });

  it('guessing room codes is rate limited per user', async () => {
    const user = await createUser();
    const guess = () => request(app).post('/api/rooms/ZZZZZZ/join').set('Cookie', authCookie(user));

    for (let i = 0; i < 20; i++) assert.equal((await guess()).status, 404);
    const blocked = await guess();
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /too many join attempts/i);
  });
});