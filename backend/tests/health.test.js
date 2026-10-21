require('./helpers/env'); // sabse pehle
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { pool } = require('./helpers/db');

after(() => pool.end());

describe('health check', () => {
  it('says ok when the database answers', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  it('answers 503, with no details, when the database is down', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    pool.query = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    };
    try {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { status: 'unavailable' });
    } finally {
      delete pool.query;
      console.error = originalConsoleError;
    }
  });

  it('the old db-check route that showed the database time is gone', async () => {
    const res = await request(app).get('/api/db-check');
    assert.equal(res.status, 404);
  });
});