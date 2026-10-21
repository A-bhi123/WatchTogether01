// Unit test: ICE servers (STUN/TURN) ki list aur TURN ke time-limited credentials
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildIceServers } = require('../../src/services/turn.service');

const KEYS = ['TURN_HOST', 'TURN_SECRET', 'TURN_PORT', 'TURN_TTL_SECONDS'];
let saved;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('buildIceServers', () => {
  it('gives only STUN when no TURN server is configured', () => {
    const servers = buildIceServers(1);
    assert.ok(servers.length >= 1);
    assert.ok(servers.every((server) => String(server.urls).startsWith('stun:')));
    assert.ok(servers.every((server) => !server.username && !server.credential));
  });

  it('adds TURN with a time-limited username and an HMAC credential', () => {
    process.env.TURN_HOST = 'turn.example.com';
    process.env.TURN_SECRET = 'super-secret-value';
    const now = Date.UTC(2026, 0, 1);

    const turn = buildIceServers(42, now).find((server) => server.username);

    assert.equal(turn.username, `${Math.floor(now / 1000) + 24 * 60 * 60}:42`);
    const expected = crypto.createHmac('sha1', 'super-secret-value').update(turn.username).digest('base64');
    assert.equal(turn.credential, expected);
    assert.deepEqual(turn.urls, [
      'turn:turn.example.com:3478?transport=udp',
      'turn:turn.example.com:3478?transport=tcp',
    ]);
  });

  it('never puts the secret itself in the list', () => {
    process.env.TURN_HOST = 'turn.example.com';
    process.env.TURN_SECRET = 'super-secret-value';
    assert.equal(JSON.stringify(buildIceServers(7)).includes('super-secret-value'), false);
  });

  it('honours the port and lifetime settings', () => {
    process.env.TURN_HOST = 'turn.example.com';
    process.env.TURN_SECRET = 'abc';
    process.env.TURN_PORT = '5000';
    process.env.TURN_TTL_SECONDS = '600';
    const now = 1_000_000_000_000;

    const turn = buildIceServers(5, now).find((server) => server.username);
    assert.equal(turn.username, `${Math.floor(now / 1000) + 600}:5`);
    assert.ok(turn.urls[0].includes(':5000?'));
  });

  it('gives every user different credentials', () => {
    process.env.TURN_HOST = 'turn.example.com';
    process.env.TURN_SECRET = 'abc';
    const a = buildIceServers(1).find((server) => server.username);
    const b = buildIceServers(2).find((server) => server.username);
    assert.notEqual(a.username, b.username);
    assert.notEqual(a.credential, b.credential);
  });
});