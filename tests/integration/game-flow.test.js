'use strict';
/**
 * Integration test — full game lifecycle, using mongodb-memory-server.
 * Run with: npm run test:integration
 *
 * Covers: createSession → addTeam → selectCategories → lobby → playing →
 *         selectQuestion → showAnswer → assignScore → next → ...repeat → finished → restart
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) await collections[key].deleteMany({});
});

describe('Full Game Flow — Integration', () => {
  let User, Question, GameSession, GameService, CreditsService;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-integration';
    User        = require('../../src/models/User');
    Question    = require('../../src/models/Question');
    GameSession = require('../../src/models/GameSession');
    GameService = require('../../src/modules/game/game.service');
    CreditsService = require('../../src/services/credits.service');
  });

  async function makeHost() {
    const user = await User.create({ username: 'testhost', email: 'host@test.com', password: 'password123', role: 'host' });
    await CreditsService.setPlan(user._id, 'unlimited'); // avoid credit limits in tests
    return user;
  }

  async function seedQuestions(category, count = 4) {
    const values = [200, 400, 600, 800];
    const docs = [];
    for (let i = 0; i < count; i++) {
      docs.push({
        category, value: values[i % 4],
        text: `${category} question ${i}`,
        answer: `Answer ${i}`,
        hint: values[i % 4] === 800 ? `Hint for ${i}` : undefined,
        isActive: true,
      });
    }
    return Question.insertMany(docs);
  }

  test('complete game lifecycle: setup → lobby → playing → finished → restart', async () => {
    const host = await makeHost();

    // Seed 6 categories with 4 questions each
    const categories = ['Science','History','Sports','Movies','Music','Tech'];
    for (const cat of categories) await seedQuestions(cat, 4);

    // 1. Create session
    const session = await GameService.createSession(host._id, {});
    expect(session.state).toBe('setup');
    expect(session.code).toHaveLength(6);

    // 2. Add 2 teams
    const teamA = await GameService.addTeam(session._id, host._id, 'Team Alpha');
    const teamB = await GameService.addTeam(session._id, host._id, 'Team Beta');
    expect(teamA.name).toBe('Team Alpha');

    // 3. Select 6 categories — builds the board
    const board = await GameService.selectCategories(session._id, host._id, categories);
    expect(board).toHaveLength(6);
    expect(board[0].values).toHaveLength(4);

    // 4. Transition to lobby
    let s = await GameService.transition(session._id, 'lobby', host._id, 'host');
    expect(s.state).toBe('lobby');
    expect(s.locked).toBe(true);

    // 5. Start game
    s = await GameService.transition(session._id, 'playing', host._id, 'host');
    expect(s.state).toBe('playing');

    // 6. Select a question
    const { session: afterQ, question } = await GameService.selectQuestion(session._id, host._id, 'Science', 200);
    expect(afterQ.state).toBe('question');
    expect(question.category).toBe('Science');

    // 7. Show answer
    const { session: afterAns } = await GameService.showAnswer(session._id, host._id);
    expect(afterAns.state).toBe('answer');

    // 8. Assign score (correct)
    const { session: afterScore, boardComplete } = await GameService.assignScore(session._id, host._id, teamA.id, true);
    expect(afterScore.state).toBe('scoring');
    expect(afterScore.teams.find(t => t.id === teamA.id).score).toBe(200);
    expect(boardComplete).toBe(false);

    // 9. Next question
    s = await GameService.nextQuestion(session._id, host._id);
    expect(s.state).toBe('playing');

    // 10. Exhaust the entire board (24 questions total)
    for (let i = 0; i < 23; i++) {
      const live = await GameSession.findById(session._id);
      const col = live.board.find(c => c.values.some(v => !v.used));
      if (!col) break;
      const cell = col.values.find(v => !v.used);

      await GameService.selectQuestion(session._id, host._id, col.category, cell.value);
      await GameService.showAnswer(session._id, host._id);
      const { boardComplete: bc } = await GameService.assignScore(session._id, host._id, teamB.id, true);
      if (bc) {
        const finalState = await GameService.nextQuestion(session._id, host._id);
        expect(finalState.state).toBe('finished');
        break;
      }
      await GameService.nextQuestion(session._id, host._id);
    }

    const finished = await GameSession.findById(session._id);
    expect(finished.state).toBe('finished');

    // 11. Restart — scores reset, board reset, back to lobby
    const restarted = await GameService.restartSession(session._id, host._id);
    expect(restarted.state).toBe('lobby');
    expect(restarted.teams.every(t => t.score === 0)).toBe(true);
    expect(restarted.board.every(col => col.values.every(v => !v.used))).toBe(true);
  }, 30000);

  test('rejects invalid state transitions', async () => {
    const host = await makeHost();
    const session = await GameService.createSession(host._id, {});
    await expect(GameService.transition(session._id, 'playing', host._id, 'host'))
      .rejects.toThrow(/Invalid transition/);
  });

  test('rejects question selection outside playing state', async () => {
    const host = await makeHost();
    const session = await GameService.createSession(host._id, {});
    await expect(GameService.selectQuestion(session._id, host._id, 'Science', 200))
      .rejects.toThrow(/not in playing state/);
  });

  test('rejects category selection with fewer than 4 questions', async () => {
    const host = await makeHost();
    await seedQuestions('Sparse', 2); // only 2 questions
    const categories = ['Sparse','A','B','C','D','E'];
    for (const c of ['A','B','C','D','E']) await seedQuestions(c, 4);

    const session = await GameService.createSession(host._id, {});
    await expect(GameService.selectCategories(session._id, host._id, categories))
      .rejects.toThrow(/Not enough questions/);
  });

  test('prevents host from controlling another hosts session (IDOR)', async () => {
    const hostA = await makeHost();
    const hostB = await User.create({ username: 'hostB', email: 'hostb@test.com', password: 'password123', role: 'host' });
    await CreditsService.setPlan(hostB._id, 'unlimited');

    const session = await GameService.createSession(hostA._id, {});
    await expect(GameService.transition(session._id, 'lobby', hostB._id, 'host'))
      .rejects.toThrow(/not found/i);
  });

  test('credits: trial user blocked after 3 sessions', async () => {
    const user = await User.create({ username: 'trialuser', email: 'trial@test.com', password: 'password123', role: 'host' });
    // Default plan is trial with max 3
    await GameService.createSession(user._id, {});
    await GameService.createSession(user._id, {});
    await GameService.createSession(user._id, {});
    await expect(GameService.createSession(user._id, {})).rejects.toThrow(/Trial limit reached/);
  });

  test('duplicate team names rejected', async () => {
    const host = await makeHost();
    const session = await GameService.createSession(host._id, {});
    await GameService.addTeam(session._id, host._id, 'Alpha');
    await expect(GameService.addTeam(session._id, host._id, 'alpha')) // case-insensitive
      .rejects.toThrow(/taken/);
  });

  test('session deletion cascades to logs and snapshots', async () => {
    const host  = await makeHost();
    const GameLog  = require('../../src/models/GameLog');
    const Snapshot = require('../../src/models/Snapshot');
    const session = await GameService.createSession(host._id, {});
    await GameService.addTeam(session._id, host._id, 'Team1');

    expect(await GameLog.countDocuments({ sessionId: session._id })).toBeGreaterThan(0);

    await GameService.deleteSession(session._id, host._id, 'host');

    expect(await GameSession.findById(session._id)).toBeNull();
    expect(await GameLog.countDocuments({ sessionId: session._id })).toBe(0);
    expect(await Snapshot.countDocuments({ sessionId: session._id })).toBe(0);
  });
});
