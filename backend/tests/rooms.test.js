require('./helpers/env'); // sabse pehle
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { pool, createUser, authCookie, createRoomRow, addMember, scalar } = require('./helpers/db');

after(() => pool.end());

// call('post', '/api/rooms', user).send({...}) : user ho to uski cookie ke saath, nahi to bina login ke
function call(method, path, user) {
  const req = request(app)[method](path);
  return user ? req.set('Cookie', authCookie(user)) : req;
}

describe('rooms need a login', () => {
  it('listing, creating and deleting are all refused without one', async () => {
    assert.equal((await call('get', '/api/rooms/my-rooms')).status, 401);
    assert.equal((await call('post', '/api/rooms')).status, 401);
    assert.equal((await call('delete', '/api/rooms/ABC123')).status, 401);
  });
});

describe('creating rooms', () => {
  it('makes the creator the host and lists the room only for its members', async () => {
    const host = await createUser();
    const other = await createUser();

    const created = await call('post', '/api/rooms', host).send({ name: 'Movie Night' });
    assert.ok([200, 201].includes(created.status), `unexpected status ${created.status}`);
    const code = created.body.room.room_code;
    assert.equal(code.length, 6);

    const mine = await call('get', '/api/rooms/my-rooms', host);
    const found = mine.body.rooms.find((room) => room.room_code === code);
    assert.ok(found, 'the host should see the new room');
    assert.equal(found.is_host, true);
    assert.equal(found.name, 'Movie Night');

    const theirs = await call('get', '/api/rooms/my-rooms', other);
    assert.equal(theirs.body.rooms.some((room) => room.room_code === code), false);
  });

  it('refuses an empty name and a name that is too long', async () => {
    const host = await createUser();
    assert.equal((await call('post', '/api/rooms', host).send({ name: '   ' })).status, 400);
    assert.equal((await call('post', '/api/rooms', host).send({ name: 'x'.repeat(61) })).status, 400);
  });
});

describe('who can enter a room', () => {
  it('a stranger cannot read the room, its chat or its movie', async () => {
    const host = await createUser();
    const stranger = await createUser();
    const room = await createRoomRow(host);

    for (const path of [`/api/rooms/${room.code}`, `/api/rooms/${room.code}/messages`, `/api/rooms/${room.code}/video`]) {
      const res = await call('get', path, stranger);
      assert.equal(res.status, 403, `${path} should be refused`);
    }
  });

  it('a member can read the room, the chat and the movie info', async () => {
    const host = await createUser();
    const member = await createUser();
    const room = await createRoomRow(host);
    await addMember(room, member);

    const info = await call('get', `/api/rooms/${room.code}`, member);
    assert.equal(info.status, 200);
    assert.equal(info.body.room.isHost, false);
    assert.equal(info.body.members.length, 2);

    assert.equal((await call('get', `/api/rooms/${room.code}/messages`, member)).status, 200);
    assert.ok((await call('get', `/api/rooms/${room.code}/video`, member)).status < 400);
  });

  it('joining with the code makes you a member', async () => {
    const host = await createUser();
    const guest = await createUser();
    const room = await createRoomRow(host);

    assert.equal((await call('post', '/api/rooms/NOPE00/join', guest)).status, 404);

    const joined = await call('post', `/api/rooms/${room.code}/join`, guest);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.room.code, room.code);
    assert.equal((await call('get', `/api/rooms/${room.code}`, guest)).status, 200);
  });

  it('an ended room answers 410 and cannot be joined', async () => {
    const host = await createUser();
    const guest = await createUser();
    const room = await createRoomRow(host);
    await pool.query(`UPDATE rooms SET status = 'closed' WHERE id = $1`, [room.id]);

    assert.equal((await call('get', `/api/rooms/${room.code}`, host)).status, 410);
    assert.equal((await call('post', `/api/rooms/${room.code}/join`, guest)).status, 400);
  });

  it('a person the host removed cannot come back through the code', async () => {
    const host = await createUser();
    const banned = await createUser();
    const room = await createRoomRow(host);
    await pool.query('INSERT INTO room_bans (room_id, user_id) VALUES ($1, $2)', [room.id, banned.id]);

    const res = await call('post', `/api/rooms/${room.code}/join`, banned);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /removed/i);
  });

  it('a full room refuses new people but lets old members back in', async () => {
    // tests/helpers/env.js mein MAX_ROOM_MEMBERS = 3
    const host = await createUser();
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const room = await createRoomRow(host); // 1
    const join = (user) => call('post', `/api/rooms/${room.code}/join`, user);

    assert.equal((await join(a)).status, 200); // 2
    assert.equal((await join(b)).status, 200); // 3

    const full = await join(c);
    assert.equal(full.status, 403);
    assert.match(full.body.error, /full/i);

    assert.equal((await join(a)).status, 200); // purana member wapas aa sakta hai
  });

  it('only the host can upload a movie', async () => {
    const host = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const room = await createRoomRow(host);
    await addMember(room, member);
    const path = `/api/rooms/${room.code}/videos`;

    const asMember = await call('post', path, member);
    assert.equal(asMember.status, 403);
    assert.match(asMember.body.error, /host/i);

    assert.equal((await call('post', path, stranger)).status, 403);
    assert.equal((await call('post', path)).status, 401);
  });
});

describe('deleting a room', () => {
  it('a stranger cannot delete it, and an unknown code is a 404', async () => {
    const host = await createUser();
    const stranger = await createUser();
    const room = await createRoomRow(host);

    assert.equal((await call('delete', `/api/rooms/${room.code}`, stranger)).status, 403);
    assert.equal(await scalar('SELECT COUNT(*)::int FROM rooms WHERE id = $1', [room.id]), 1);
    assert.equal((await call('delete', '/api/rooms/NOPE00', host)).status, 404);
  });

  it('a member only removes the room from their own list', async () => {
    const host = await createUser();
    const member = await createUser();
    const room = await createRoomRow(host);
    await addMember(room, member);

    const res = await call('delete', `/api/rooms/${room.code}`, member);
    assert.equal(res.status, 200);
    assert.equal(res.body.scope, 'me');

    assert.equal(await scalar('SELECT COUNT(*)::int FROM rooms WHERE id = $1', [room.id]), 1);
    const members = await scalar('SELECT COUNT(*)::int FROM room_members WHERE room_id = $1', [room.id]);
    assert.equal(members, 1); // sirf host bacha
  });

  it('the host deletes the room and everything in it for everyone', async () => {
    const host = await createUser();
    const member = await createUser();
    const banned = await createUser();
    const room = await createRoomRow(host);
    await addMember(room, member);
    await pool.query(`INSERT INTO messages (room_id, user_id, message) VALUES ($1, $2, 'hello')`, [room.id, member.id]);
    await pool.query('INSERT INTO room_bans (room_id, user_id) VALUES ($1, $2)', [room.id, banned.id]);

    const res = await call('delete', `/api/rooms/${room.code}`, host);
    assert.equal(res.status, 200);
    assert.equal(res.body.scope, 'everyone');

    for (const table of ['rooms', 'room_members', 'messages', 'room_bans']) {
      const column = table === 'rooms' ? 'id' : 'room_id';
      const left = await scalar(`SELECT COUNT(*)::int FROM ${table} WHERE ${column} = $1`, [room.id]);
      assert.equal(left, 0, `${table} should be empty after the room is deleted`);
    }
    assert.equal((await call('post', `/api/rooms/${room.code}/join`, member)).status, 404);
  });
});