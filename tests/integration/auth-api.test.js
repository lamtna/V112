'use strict';
/**
 * Auth API integration tests via supertest.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

let mongod, app;

beforeAll(async () => {
  process.env.JWT_SECRET  = 'test-secret';
  process.env.NODE_ENV    = 'test';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const createApp = require('../../src/app');
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) await collections[key].deleteMany({});
});

describe('Auth API', () => {
  test('POST /api/auth/register — creates host account', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newhost', email: 'newhost@test.com', password: 'password123', role: 'host' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('host');
    expect(res.body.token).toBeDefined();
    expect(res.body.user.password).toBeUndefined(); // never leak password hash
  });

  test('POST /api/auth/register — blocks admin self-registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'sneaky', email: 'sneaky@test.com', password: 'password123', role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('player'); // downgraded, not admin
  });

  test('POST /api/auth/register — rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'shortpw', email: 'shortpw@test.com', password: '123' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/register — rejects duplicate email', async () => {
    await request(app).post('/api/auth/register').send({ username: 'u1', email: 'dup@test.com', password: 'password123' });
    const res = await request(app).post('/api/auth/register').send({ username: 'u2', email: 'dup@test.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  test('POST /api/auth/login — succeeds with correct credentials', async () => {
    await request(app).post('/api/auth/register').send({ username: 'loginuser', email: 'login@test.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email: 'login@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined(); // refresh token cookie
  });

  test('POST /api/auth/login — fails with wrong password (uniform error)', async () => {
    await request(app).post('/api/auth/register').send({ username: 'wronguser', email: 'wrong@test.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email: 'wrong@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('POST /api/auth/login — fails for non-existent user (same error as wrong password)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'password123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials'); // no user enumeration
  });

  test('GET /api/auth/me — requires authentication', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me — returns profile with valid token', async () => {
    const reg = await request(app).post('/api/auth/register').send({ username: 'meuser', email: 'me@test.com', password: 'password123' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@test.com');
  });

  test('GET /api/auth/users — requires admin role', async () => {
    const reg = await request(app).post('/api/auth/register').send({ username: 'notadmin', email: 'notadmin@test.com', password: 'password123', role: 'host' });
    const res = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(403);
  });

  test('Rate limiting on /api/auth — exceeds limit returns 429', async () => {
    const requests = [];
    for (let i = 0; i < 35; i++) {
      requests.push(request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'wrong' }));
    }
    const results = await Promise.all(requests);
    const rateLimited = results.some(r => r.status === 429);
    expect(rateLimited).toBe(true);
  }, 15000);
});
