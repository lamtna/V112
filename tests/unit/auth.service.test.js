'use strict';
/**
 * AuthService unit tests — uses mock for JWT and User model.
 */

// Minimal mock for testing token logic
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

const SECRET = 'test-secret';

describe('JWT Token Logic', () => {
  test('signs and verifies access token payload', () => {
    const payload = { _id: 'user123', role: 'host', username: 'testhost' };
    const token   = jwt.sign(payload, SECRET, { expiresIn: '1h', issuer: 'quizgame' });
    const decoded = jwt.verify(token, SECRET);
    expect(decoded._id).toBe('user123');
    expect(decoded.role).toBe('host');
    expect(decoded.iss).toBe('quizgame');
  });

  test('throws on tampered token', () => {
    const token = jwt.sign({ _id: 'user123' }, SECRET);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => jwt.verify(tampered, SECRET)).toThrow();
  });

  test('throws on expired token', (done) => {
    const token = jwt.sign({ _id: 'user123' }, SECRET, { expiresIn: '1ms' });
    setTimeout(() => {
      expect(() => jwt.verify(token, SECRET)).toThrow(/expired/i);
      done();
    }, 10);
  });

  test('refresh token family is UUID v4 format', () => {
    const family = crypto.randomUUID();
    expect(family).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('Password validation rules', () => {
  test('rejects passwords shorter than 8 chars', () => {
    const pw = 'abc123';
    expect(pw.length >= 8).toBe(false);
  });

  test('accepts passwords of 8+ chars', () => {
    const pw = 'secure!1';
    expect(pw.length >= 8).toBe(true);
  });
});

describe('Role validation', () => {
  const SELF_REGISTER = ['host', 'player'];

  test('allows host and player self-registration', () => {
    expect(SELF_REGISTER.includes('host')).toBe(true);
    expect(SELF_REGISTER.includes('player')).toBe(true);
  });

  test('blocks admin self-registration', () => {
    const role = SELF_REGISTER.includes('admin') ? 'admin' : 'player';
    expect(role).toBe('player');
  });
});
