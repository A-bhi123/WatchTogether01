const { lastOtpFor } = require('./helpers/env'); // sabse pehle: test settings + nakli email
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { pool, createUser, authCookie } = require('./helpers/db');
const { cookiePair, cookieLine } = require('./helpers/http');

after(() => pool.end());

const wrongCode = (otp) => (otp === '000000' ? '111111' : '000000');

// Step 1 (password) karke OTP aur "pending" cookie wapas deta hai
async function startLogin(user, password = user.password) {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
  return { res, pending: cookiePair(res, 'pending_login'), otp: lastOtpFor(user.email) };
}

function verifyOtp(pending, otp) {
  return request(app).post('/api/auth/verify-otp').set('Cookie', pending).send({ otp });
}

function expireOtp(userId) {
  return pool.query(`UPDATE otp_verifications SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [userId]);
}

describe('who am I (/api/auth/me)', () => {
  it('needs a login', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'token=not-a-real-token');
    assert.equal(res.status, 401);
  });

  it('returns the user, but never the password hash or the token version', async () => {
    const user = await createUser();
    const res = await request(app).get('/api/auth/me').set('Cookie', authCookie(user));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.email);
    assert.equal('password_hash' in res.body.user, false);
    assert.equal('token_version' in res.body.user, false);
  });
});

describe('login, step 1: the password', () => {
  it('answers a wrong password and an unknown email identically', async () => {
    const user = await createUser();
    const wrong = await startLogin(user, 'WrongPass99');
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody-here@example.test', password: 'Whatever99' });

    assert.equal(wrong.res.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.res.body.error, unknown.body.error); // koi nahi bata sakta ki email registered hai
  });

  it('a correct password sends an OTP but does NOT log you in', async () => {
    const user = await createUser();
    const { res, pending, otp } = await startLogin(user);

    assert.equal(res.status, 200);
    assert.equal(res.body.otpRequired, true);
    assert.match(otp, /^\d{6}$/);
    assert.ok(pending, 'the pending_login cookie should be set');
    assert.equal(cookiePair(res, 'token'), null, 'no real login token yet');
  });

  it('the pending cookie alone cannot open protected pages', async () => {
    const user = await createUser();
    const { pending } = await startLogin(user);
    const res = await request(app).get('/api/rooms/my-rooms').set('Cookie', pending);
    assert.equal(res.status, 401);
  });

  it('an unverified email cannot log in and gets no OTP', async () => {
    const user = await createUser({ verified: false });
    const { res, otp } = await startLogin(user);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(otp, null);
  });
});

describe('login, step 2: the OTP', () => {
  it('a wrong OTP is refused and the attempts left are counted', async () => {
    const user = await createUser();
    const { pending, otp } = await startLogin(user);
    const res = await verifyOtp(pending, wrongCode(otp));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'WRONG_OTP');
    assert.match(res.body.error, /4 attempts left/);
  });

  it('after 5 wrong tries even the correct OTP is refused', async () => {
    const user = await createUser();
    const { pending, otp } = await startLogin(user);
    for (let i = 0; i < 5; i++) await verifyOtp(pending, wrongCode(otp));

    const res = await verifyOtp(pending, otp);
    assert.equal(res.status, 429);
    assert.equal(res.body.code, 'TOO_MANY_ATTEMPTS');
  });

  it('the correct OTP logs you in with a safe cookie', async () => {
    const user = await createUser();
    const { pending, otp } = await startLogin(user);
    const res = await verifyOtp(pending, otp);

    assert.equal(res.status, 200);
    assert.equal('token_version' in res.body.user, false);
    assert.equal('password_hash' in res.body.user, false);

    const line = cookieLine(res, 'token');
    assert.match(line, /HttpOnly/i); // JavaScript is cookie ko padh nahi sakti
    assert.match(line, /SameSite=Lax/i);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookiePair(res, 'token'));
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, user.email);
  });

  it('an OTP can be used only once', async () => {
    const user = await createUser();
    const { pending, otp } = await startLogin(user);
    assert.equal((await verifyOtp(pending, otp)).status, 200);

    const again = await verifyOtp(pending, otp); // wahi pending cookie, wahi code
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'NO_OTP');
  });

  it('an expired OTP is refused, whatever any page timer says', async () => {
    const user = await createUser();
    const { pending, otp } = await startLogin(user);
    await expireOtp(user.id);

    const res = await verifyOtp(pending, otp);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'EXPIRED');
  });

  it('otp-status needs the pending cookie', async () => {
    const res = await request(app).get('/api/auth/otp-status').query({ purpose: 'login' });
    assert.equal(res.status, 401);
  });

  it('otp-status reports time and attempts from the server clock', async () => {
    const user = await createUser();
    const { pending } = await startLogin(user);
    const status = () => request(app).get('/api/auth/otp-status').query({ purpose: 'login' }).set('Cookie', pending);

    const first = await status();
    assert.equal(first.status, 200);
    assert.equal(first.body.exists, true);
    assert.ok(first.body.expiresInSeconds > 100 && first.body.expiresInSeconds <= 120);
    assert.equal(first.body.attemptsLeft, 5);
    assert.ok(first.body.resendInSeconds >= 1 && first.body.resendInSeconds <= 30);

    await expireOtp(user.id);
    const second = await status();
    assert.equal(second.body.expiresInSeconds, 0);
  });
});

describe('sessions and password reset', () => {
  it('raising token_version kills every old token', async () => {
    const user = await createUser();
    const cookie = authCookie(user);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);

    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
  });

  it('forgot-password answers the same for known and unknown emails', async () => {
    const user = await createUser();
    const known = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost-user@example.test' });

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.match(lastOtpFor(user.email), /^\d{6}$/); // sirf asli user ko OTP gaya
    assert.equal(lastOtpFor('ghost-user@example.test'), null);
  });

  it('a weak new password is refused before the OTP is used up', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const otp = lastOtpFor(user.email);

    const weak = await request(app).post('/api/auth/reset-password').send({ email: user.email, otp, newPassword: '12345678' });
    assert.equal(weak.status, 400);
    assert.match(weak.body.error, /letter and one number/);

    const strong = await request(app).post('/api/auth/reset-password').send({ email: user.email, otp, newPassword: 'NewPass456' });
    assert.equal(strong.status, 200); // wahi OTP abhi bhi chalta hai
  });

  it('a reset changes the password and logs out every old session', async () => {
    const user = await createUser({ password: 'OldPass123' });
    const oldCookie = authCookie(user);

    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const otp = lastOtpFor(user.email);
    const reset = await request(app).post('/api/auth/reset-password').send({ email: user.email, otp, newPassword: 'NewPass456' });
    assert.equal(reset.status, 200);

    assert.equal((await startLogin(user, 'OldPass123')).res.status, 401); // purana password band
    assert.equal((await startLogin(user, 'NewPass456')).res.status, 200); // naya chalta hai
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status, 401); // purana login bekaar
  });
});