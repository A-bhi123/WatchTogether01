const { TRUSTED_ORIGIN } = require('./helpers/env'); // sabse pehle
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { io: connectClient } = require('socket.io-client');
const { createServer } = require('../src/createServer'); // bilkul wahi server jo asli app chalati hai
const { pool, createUser, authCookie, tokenFor, createRoomRow, addMember, scalar } = require('./helpers/db');

describe('real-time sockets', () => {
  const { server, io } = createServer();
  let port;
  const opened = [];

  before(
    () =>
      new Promise((resolve) => {
        server.listen(0, () => {
          port = server.address().port; // 0 = khaali port khud chun lo
          resolve();
        });
      })
  );
  afterEach(() => {
    opened.splice(0).forEach((socket) => socket.disconnect());
  });
  after(async () => {
    await new Promise((resolve) => io.close(resolve));
    await pool.end();
  });

  // ---------- chhote helper ----------
  // Agla "event" aane tak ruko (3 sec mein na aaye to test fail)
  function once(socket, event, ms = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), ms);
      socket.once(event, (...args) => {
        clearTimeout(timer);
        resolve(args[0]);
      });
    });
  }

  function open(cookie, origin = TRUSTED_ORIGIN) {
    const headers = { origin };
    if (cookie) headers.cookie = cookie;
    const socket = connectClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      extraHeaders: headers,
      reconnection: false,
      forceNew: true,
    });
    opened.push(socket);
    return socket;
  }

  async function connect(user) {
    const socket = open(authCookie(user));
    await once(socket, 'connect');
    return socket;
  }

  function enter(socket, room) {
    const online = once(socket, 'room:online-users');
    socket.emit('room:join', room.code);
    return online;
  }

  // Host aur member dono ban jate hain aur dono room mein pahunch jate hain
  async function setupRoom() {
    const host = await createUser();
    const member = await createUser();
    const room = await createRoomRow(host);
    await addMember(room, member);
    const hostSocket = await connect(host);
    const memberSocket = await connect(member);
    await enter(hostSocket, room);
    await enter(memberSocket, room);
    return { host, member, room, hostSocket, memberSocket };
  }

  // ---------- tests ----------
  describe('who can connect', () => {
    it('refuses a visitor with no login cookie', async () => {
      const socket = open(null);
      const error = await once(socket, 'connect_error');
      assert.equal(error.message, 'Not authenticated');
    });

    it('refuses a connection that comes from another website', async () => {
      const user = await createUser();
      const socket = open(authCookie(user), 'http://evil.example');
      await once(socket, 'connect_error');
      assert.equal(socket.connected, false);
    });

    it('accepts a logged-in user on our own website', async () => {
      const user = await createUser();
      const socket = await connect(user);
      assert.equal(socket.connected, true);
    });

    it('refuses a token issued before a password reset', async () => {
      const user = await createUser();
      const oldToken = tokenFor(user);
      await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);

      const socket = open(`token=${oldToken}`);
      const error = await once(socket, 'connect_error');
      assert.equal(error.message, 'Not authenticated');
    });
  });

  describe('joining a room', () => {
    it('a stranger is told they are not a member', async () => {
      const host = await createUser();
      const stranger = await createUser();
      const room = await createRoomRow(host);
      const socket = await connect(stranger);

      const error = once(socket, 'room:error');
      socket.emit('room:join', room.code);
      assert.equal(await error, 'You are not a member of this room');
    });

    it('a member joins and appears in the online list', async () => {
      const host = await createUser();
      const room = await createRoomRow(host);
      const socket = await connect(host);

      const online = await enter(socket, room);
      assert.ok(online.some((person) => person.id === host.id));
    });
  });

  describe('chat', () => {
    it('reaches everyone in the room and is stored encrypted', async () => {
      const { hostSocket, memberSocket } = await setupRoom();

      const received = once(hostSocket, 'chat:message');
      memberSocket.emit('chat:send', { message: 'hello team' });
      const message = await received;
      assert.equal(message.message, 'hello team');

      const stored = await scalar('SELECT message FROM messages WHERE id = $1', [message.id]);
      assert.ok(stored.startsWith('enc1:'), 'the database should hold encrypted text');
      assert.equal(stored.includes('hello'), false);
    });

    it('a flood of messages is cut off with a "too fast" warning', async () => {
      const { memberSocket } = await setupRoom();

      const warning = once(memberSocket, 'room:error');
      for (let i = 0; i < 20; i++) memberSocket.emit('chat:send', { message: `spam ${i}` });
      assert.match(await warning, /too fast/i);
    });

    it('the host can turn chat off for members', async () => {
      const { room, hostSocket, memberSocket } = await setupRoom();

      const status = once(memberSocket, 'room:chat-status');
      hostSocket.emit('host:set-chat', { enabled: false });
      assert.deepEqual(await status, { enabled: false });
      assert.equal(await scalar('SELECT chat_enabled FROM rooms WHERE id = $1', [room.id]), false);

      const refused = once(memberSocket, 'chat:error');
      memberSocket.emit('chat:send', { message: 'can anyone hear me' });
      assert.equal(await refused, 'Chat is disabled by the host.');
    });

    it('deleting for everyone: only your own message, but the host may delete any', async () => {
      const { hostSocket, memberSocket } = await setupRoom();

      // Host ka message: member use sabke liye delete nahi kar sakta
      const hostMessageSeen = once(memberSocket, 'chat:message');
      hostSocket.emit('chat:send', { message: 'from the host' });
      const hostMessage = await hostMessageSeen;

      const refused = once(memberSocket, 'chat:error');
      memberSocket.emit('chat:delete', { messageIds: [hostMessage.id], scope: 'everyone' });
      assert.match(await refused, /only your own messages/i);
      assert.equal(await scalar('SELECT deleted_at IS NOT NULL FROM messages WHERE id = $1', [hostMessage.id]), false);

      // Member ka message: host delete kar sakta hai
      const memberMessageSeen = once(hostSocket, 'chat:message');
      memberSocket.emit('chat:send', { message: 'from the member' });
      const memberMessage = await memberMessageSeen;

      const deleted = once(memberSocket, 'chat:deleted');
      hostSocket.emit('chat:delete', { messageIds: [memberMessage.id], scope: 'everyone' });
      assert.deepEqual((await deleted).ids, [memberMessage.id]);
      assert.equal(await scalar('SELECT deleted_at IS NOT NULL FROM messages WHERE id = $1', [memberMessage.id]), true);
    });
  });

  describe('host powers', () => {
    it('a member cannot end the room', async () => {
      const { room, memberSocket } = await setupRoom();

      const error = once(memberSocket, 'room:error');
      memberSocket.emit('host:end-room');
      assert.equal(await error, 'Only the host can do this');
      assert.equal(await scalar('SELECT status FROM rooms WHERE id = $1', [room.id]), 'active');
    });

    it('the host ends the room for everyone', async () => {
      const { room, hostSocket, memberSocket } = await setupRoom();

      const closed = once(memberSocket, 'room:closed');
      hostSocket.emit('host:end-room');
      await closed;
      assert.equal(await scalar('SELECT status FROM rooms WHERE id = $1', [room.id]), 'closed');
    });
  });
});