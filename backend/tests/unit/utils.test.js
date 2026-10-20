// Unit test: koi database ya server nahi chahiye, sirf chhote functions ki jaanch
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validatePassword } = require('../../src/utils/validators');
const throttle = require('../../src/utils/loginThrottle');

describe('validatePassword', () => {
  it('accepts a good password', () => {
    assert.equal(validatePassword('Abcd1234'), null);
  });

  it('rejects anything that is not a string', () => {
    assert.match(validatePassword(undefined), /required/i);
    assert.match(validatePassword(12345678), /required/i);
    assert.match(validatePassword({ a: 1 }), /required/i);
  });

  it('rejects passwords shorter than 8 characters', () => {
    assert.match(validatePassword('Ab1'), /at least 8/);
    assert.match(validatePassword('Abcde12'), /at least 8/); // 7 akshar
  });

  it('needs both a letter and a number', () => {
    assert.match(validatePassword('abcdefgh'), /letter and one number/);
    assert.match(validatePassword('12345678'), /letter and one number/);
  });

  it('rejects very common passwords, in any letter case', () => {
    assert.match(validatePassword('password1'), /too common/);
    assert.match(validatePassword('PassWord1'), /too common/);
  });

  it('rejects passwords over 72 bytes (bcrypt silently cuts them)', () => {
    assert.match(validatePassword('a1'.repeat(37)), /too long/); // 74 bytes
    assert.equal(validatePassword('a1'.repeat(36)), null); // 72 bytes, theek
  });

  it('counts bytes, not characters', () => {
    // Har "é" 2 byte ka hai: 37 akshar = 74 bytes
    assert.match(validatePassword('é'.repeat(36) + 'a1'), /too long/);
  });
});

describe('login throttle', () => {
  const ip = '10.0.0.1';

  it('lets the first 4 failures pass and blocks on the 5th', () => {
    const email = 'throttle-a@example.test';
    for (let i = 0; i < 4; i++) throttle.recordFailure(ip, email);
    assert.equal(throttle.isBlocked(ip, email), 0);
    throttle.recordFailure(ip, email);
    assert.ok(throttle.isBlocked(ip, email) >= 1);
  });

  it('a successful login clears the failures', () => {
    const email = 'throttle-b@example.test';
    for (let i = 0; i < 5; i++) throttle.recordFailure(ip, email);
    assert.ok(throttle.isBlocked(ip, email) >= 1);
    throttle.clearFailures(ip, email);
    assert.equal(throttle.isBlocked(ip, email), 0);
  });

  it('is separate per IP, so nobody can lock another person out', () => {
    const email = 'throttle-c@example.test';
    for (let i = 0; i < 5; i++) throttle.recordFailure('6.6.6.6', email);
    assert.ok(throttle.isBlocked('6.6.6.6', email) >= 1);
    assert.equal(throttle.isBlocked('7.7.7.7', email), 0);
  });

  it('ignores letter case and spaces in the email', () => {
    for (let i = 0; i < 5; i++) throttle.recordFailure(ip, '  Throttle-D@Example.test ');
    assert.ok(throttle.isBlocked(ip, 'throttle-d@example.test') >= 1);
  });
});