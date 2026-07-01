'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

let mongod, app, adminToken;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.NODE_ENV   = 'test';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const createApp = require('../../src/app');
  app = createApp();

  const User = require('../../src/models/User');
  const admin = await User.create({ username: 'admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
  const jwt = require('jsonwebtoken');
  adminToken = jwt.sign({ _id: admin._id.toString(), role: 'admin', username: 'admin' }, 'test-secret', { expiresIn: '1h' });
});

afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });

afterEach(async () => {
  const Question = require('../../src/models/Question');
  await Question.deleteMany({});
});

describe('Questions API', () => {
  test('POST /api/questions — creates with hint field for 800-point question', async () => {
    const res = await request(app)
      .post('/api/questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'Science', value: 800, text: 'What is the Planck constant?', answer: '6.626×10⁻³⁴ J·s', hint: 'Used in quantum mechanics', difficulty: 'hard', timeLimit: 40 });

    expect(res.status).toBe(201);
    expect(res.body.question.hint).toBe('Used in quantum mechanics');
    expect(res.body.question.value).toBe(800);
  });

  test('POST /api/questions — rejects duplicate text in same category', async () => {
    await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'History', value: 200, text: 'When was WW2?', answer: '1939-1945' });
    const res = await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'History', value: 400, text: 'When was WW2?', answer: '1939-1945' });
    expect(res.status).toBe(409);
  });

  test('POST /api/questions — validates value enum', async () => {
    const res = await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'X', value: 999, text: 'Bad value question', answer: 'A' });
    expect(res.status).toBe(400);
  });

  test('GET /api/questions — search filter works', async () => {
    await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'Science', value: 200, text: 'Unique searchable text about photosynthesis', answer: 'plants' });

    const res = await request(app).get('/api/questions?search=photosynthesis').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
  });

  test('POST /api/questions/bulk — imports multiple with hints', async () => {
    const res = await request(app).post('/api/questions/bulk').set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: [
        { category: 'Tech', value: 200, text: 'What is RAM?', answer: 'Random Access Memory' },
        { category: 'Tech', value: 800, text: 'What is Big O notation?', answer: 'Complexity analysis', hint: 'Used to measure algorithm efficiency' },
      ]});
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });

  test('GET /api/questions/categories — returns distinct list', async () => {
    await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'UniqueCategoryX', value: 200, text: 'q1', answer: 'a1' });
    const res = await request(app).get('/api/questions/categories').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.categories).toContain('UniqueCategoryX');
  });

  test('DELETE /api/questions/:id — requires admin role', async () => {
    const jwt = require('jsonwebtoken');
    const playerToken = jwt.sign({ _id: 'fakeplayer', role: 'player', username: 'p' }, 'test-secret');
    const created = await request(app).post('/api/questions').set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'DelTest', value: 200, text: 'to delete', answer: 'x' });
    const res = await request(app).delete(`/api/questions/${created.body.question._id}`).set('Authorization', `Bearer ${playerToken}`);
    expect(res.status).toBe(403);
  });
});
