'use strict';
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');
const GameSession  = require('../../models/GameSession');
const GameLog      = require('../../models/GameLog');
const Snapshot     = require('../../models/Snapshot');
const Question     = require('../../models/Question');
const GameEngine   = require('./game.engine');
const GameSnapshot = require('./game.snapshot');
const CacheService = require('../../services/cache.service');
const CreditsService = require('../../services/credits.service');
const logger       = require('../../config/logger');

class GameService {
  // ─── CREATE ───────────────────────────────────────────────────────────────

  static async createSession(hostId, settings = {}) {
    // ── Credits check ──
    const check = await CreditsService.canCreateSession(hostId);
    if (!check.allowed) throw Object.assign(new Error(check.message), { status: 402, code: check.reason });

    // ── Crypto-secure unique code ──
    let code, attempts = 0;
    do {
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
      if (++attempts > 10) throw new Error('Could not generate unique session code');
    } while (await GameSession.exists({ code }));

    const session = await GameSession.create({
      code, hostId, state: 'setup', version: 0,
      teams: [], categories: [], board: [],
      settings: {
        maxTeams:  Math.min(10, Math.max(2, settings.maxTeams  || 6)),
        timeLimit: Math.min(120, Math.max(10, settings.timeLimit || 30)),
      },
    });

    // Deduct credit after successful creation
    await CreditsService.useCredit(hostId, session._id);

    await CacheService.setSession(session._id.toString(), session.toObject());
    logger.info('Session created', { sessionId: session._id, code, hostId });
    return session;
  }

  // ─── READ ─────────────────────────────────────────────────────────────────

  static async getSession(sessionId) {
    const cached = await CacheService.getSession(sessionId);
    if (cached) return cached;
    const session = await GameSession.findById(sessionId).lean();
    if (session) await CacheService.setSession(sessionId, session);
    return session;
  }

  static async getSessionByCode(code) {
    if (!code || typeof code !== 'string') return null;
    return GameSession.findOne({ code: code.toUpperCase().trim() }).lean();
  }

  static async listSessions(hostId, { page = 1, limit = 20 } = {}) {
    const p = Math.max(1, +page), l = Math.min(50, +limit);
    const [sessions, total] = await Promise.all([
      GameSession.find({ hostId }).sort({ createdAt: -1 }).skip((p-1)*l).limit(l).lean(),
      GameSession.countDocuments({ hostId }),
    ]);
    return { sessions, total, page: p, limit: l };
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────

  static async updateSettings(sessionId, hostId, settings) {
    const session = await GameSession.findOne({ _id: sessionId, hostId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'setup') throw Object.assign(new Error('Cannot change settings after setup'), { status: 409 });

    session.settings.maxTeams  = Math.min(10, Math.max(2,   settings.maxTeams  || session.settings.maxTeams));
    session.settings.timeLimit = Math.min(120, Math.max(10, settings.timeLimit || session.settings.timeLimit));
    await session.save();
    await CacheService.invalidateSession(sessionId);
    return session;
  }

  // ─── DELETE ───────────────────────────────────────────────────────────────

  static async deleteSession(sessionId, requestorId, requestorRole) {
    const session = await GameSession.findById(sessionId).lean();
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (requestorRole !== 'admin' && session.hostId.toString() !== requestorId.toString()) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    await Promise.all([
      GameSession.findByIdAndDelete(sessionId),
      GameLog.deleteMany({ sessionId }),
      Snapshot.deleteMany({ sessionId }),
      CacheService.invalidateSession(sessionId),
    ]);
    logger.info('Session deleted', { sessionId, by: requestorId });
  }

  // ─── TEAMS ────────────────────────────────────────────────────────────────

  static async addTeam(sessionId, hostId, teamName) {
    const name = (teamName || '').trim();
    if (!name || name.length > 40) throw Object.assign(new Error('Team name must be 1–40 chars'), { status: 400 });
    const session = await GameSession.findOne({ _id: sessionId, hostId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (!['setup','lobby'].includes(session.state)) throw Object.assign(new Error('Cannot add teams now'), { status: 409 });
    if (session.teams.length >= session.settings.maxTeams) throw Object.assign(new Error('Max teams reached'), { status: 409 });
    if (session.teams.find((t) => t.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('Team name taken'), { status: 409 });

    const team = { id: uuidv4(), name, score: 0, players: [], color: GameService._teamColor(session.teams.length) };
    session.teams.push(team);
    await session.save();
    await GameService._log(session._id, 'TEAM_ADD', { team }, hostId, 'host', session.version);
    await CacheService.invalidateSession(sessionId);
    return team;
  }

  static async removeTeam(sessionId, hostId, teamId) {
    const session = await GameSession.findOne({ _id: sessionId, hostId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'setup') throw Object.assign(new Error('Cannot remove teams after setup'), { status: 409 });
    const before = session.teams.length;
    session.teams = session.teams.filter((t) => t.id !== teamId);
    if (session.teams.length === before) throw Object.assign(new Error('Team not found'), { status: 404 });
    await session.save();
    await CacheService.invalidateSession(sessionId);
  }

  // ─── CATEGORIES ───────────────────────────────────────────────────────────

  static async selectCategories(sessionId, hostId, categories) {
    if (!Array.isArray(categories) || categories.length !== 6) throw Object.assign(new Error('Must select exactly 6 categories'), { status: 400 });
    const unique = [...new Set(categories.map((c) => c.trim()))];
    if (unique.length !== 6) throw Object.assign(new Error('Categories must be distinct'), { status: 400 });

    const session = await GameSession.findOne({ _id: sessionId, hostId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'setup') throw Object.assign(new Error('Can only select categories during setup'), { status: 409 });

    const questionsMap = {};
    for (const cat of unique) {
      let questions = await CacheService.getQuestions(cat);
      if (!questions) {
        questions = await Question.find({ category: cat, isActive: true }).select('_id value text answer hint timeLimit').lean();
        await CacheService.setQuestions(cat, questions);
      }
      questionsMap[cat] = questions;
    }

    for (const cat of unique) {
      if ((questionsMap[cat] || []).length < 4) {
        throw Object.assign(new Error(`Not enough questions in: ${cat} (need 4, found ${(questionsMap[cat]||[]).length})`), { status: 422 });
      }
    }

    session.categories = unique;
    session.board      = GameEngine.buildBoard(unique, questionsMap);
    await session.save();
    await CacheService.invalidateSession(sessionId);
    return session.board;
  }

  // ─── GAME FLOW ────────────────────────────────────────────────────────────

  static async transition(sessionId, targetState, actorId, actorRole) {
    const query = actorRole === 'admin' ? { _id: sessionId } : { _id: sessionId, hostId: actorId };
    const session = await GameSession.findOne(query);
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

    const result = GameEngine.transition(session, targetState);
    if (!result.success) throw Object.assign(new Error(result.error), { status: 409 });

    const prev = session.state;
    session.state   = targetState;
    session.version = result.version;
    if (targetState === 'finished') session.finishedAt = new Date();
    if (targetState === 'lobby') session.locked = true; // lock setup once in lobby

    await session.save();
    await GameService._log(sessionId, 'STATE_TRANSITION', { targetState, prevState: prev }, actorId, actorRole, session.version);
    await CacheService.invalidateSession(sessionId);

    if (GameSnapshot.shouldSnapshot(session.version)) {
      GameSnapshot.save(session, session.version).catch((e) => logger.error('Snapshot failed', { err: e.message }));
    }
    return session;
  }

  static async selectQuestion(sessionId, actorId, category, value) {
    const session = await GameSession.findOne({ _id: sessionId, hostId: actorId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'playing') throw Object.assign(new Error('Game is not in playing state'), { status: 409 });

    const board  = session.board.map((b) => b.toObject ? b.toObject() : b);
    const result = GameEngine.selectQuestion(board, category, +value);
    if (!result.success) throw Object.assign(new Error(result.error), { status: 409 });

    const question = await GameService._getQuestionById(result.cell.questionId);
    if (!question) throw Object.assign(new Error('Question data not found'), { status: 500 });

    session.board           = result.board;
    session.currentQuestion = { questionId: question._id, category, value: +value, startedAt: new Date(), timeLimit: question.timeLimit || session.settings.timeLimit };
    session.state           = 'question';
    session.version        += 1;

    await session.save();
    await GameService._log(sessionId, 'QUESTION_SELECT', { category, value: +value, currentQuestion: session.currentQuestion.toObject ? session.currentQuestion.toObject() : session.currentQuestion }, actorId, 'host', session.version);
    await CacheService.invalidateSession(sessionId);
    Question.findByIdAndUpdate(question._id, { $inc: { usageCount: 1 } }).catch(() => {});

    return { session, question };
  }

  static async showAnswer(sessionId, actorId) {
    const session = await GameSession.findOne({ _id: sessionId, hostId: actorId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'question') throw Object.assign(new Error('No active question to reveal'), { status: 409 });

    session.state   = 'answer';
    session.version += 1;
    await session.save();
    await GameService._log(sessionId, 'STATE_TRANSITION', { targetState: 'answer' }, actorId, 'host', session.version);
    await CacheService.invalidateSession(sessionId);

    const question = session.currentQuestion?.questionId ? await GameService._getQuestionById(session.currentQuestion.questionId) : null;
    return { session, question };
  }

  static async assignScore(sessionId, actorId, teamId, correct) {
    if (!teamId) throw Object.assign(new Error('teamId required'), { status: 400 });
    const session = await GameSession.findOne({ _id: sessionId, hostId: actorId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'answer') throw Object.assign(new Error('Not in answer phase'), { status: 409 });
    if (!session.currentQuestion?.value) throw Object.assign(new Error('No current question'), { status: 409 });

    const delta  = correct ? session.currentQuestion.value : -(Math.floor(session.currentQuestion.value / 2));
    const teams  = session.teams.map((t) => t.toObject ? t.toObject() : t);
    const scored = GameEngine.applyScore(teams, teamId, delta);
    if (!scored.success) throw Object.assign(new Error(scored.error), { status: 404 });

    session.teams   = scored.teams;
    session.state   = 'scoring';
    session.version += 1;
    await session.save();
    await GameService._log(sessionId, 'SCORE_UPDATE', { teamId, delta, correct }, actorId, 'host', session.version);
    await CacheService.invalidateSession(sessionId);

    const sessObj = session.toObject ? session.toObject() : session;
    const boardComplete = GameEngine.isBoardComplete(sessObj.board.map((b) => b.toObject ? b.toObject() : b));
    return { session: sessObj, boardComplete };
  }

  static async nextQuestion(sessionId, actorId) {
    const session = await GameSession.findOne({ _id: sessionId, hostId: actorId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (session.state !== 'scoring') throw Object.assign(new Error('Must be in scoring state'), { status: 409 });

    const board = session.board.map((b) => b.toObject ? b.toObject() : b);
    const target = GameEngine.isBoardComplete(board) ? 'finished' : 'playing';
    return GameService.transition(sessionId, target, actorId, 'host');
  }


  // ─── RESTART ──────────────────────────────────────────────────────────────

  /**
   * Restart a finished/in-progress game: reset scores to 0, reset board (all unused),
   * keep teams and categories, go back to lobby state.
   */
  static async restartSession(sessionId, hostId) {
    const session = await GameSession.findOne({ _id: sessionId, hostId });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (!['finished', 'scoring', 'playing'].includes(session.state)) {
      throw Object.assign(new Error('Can only restart from playing, scoring, or finished states'), { status: 409 });
    }

    // Reset teams' scores
    session.teams = session.teams.map((t) => ({ ...(t.toObject ? t.toObject() : t), score: 0 }));

    // Reset board — mark all cells unused
    session.board = session.board.map((col) => ({
      ...(col.toObject ? col.toObject() : col),
      values: col.values.map((v) => ({ ...(v.toObject ? v.toObject() : v), used: false })),
    }));

    session.currentQuestion = undefined;
    session.state           = 'lobby';
    session.version        += 1;
    session.finishedAt      = undefined;

    await session.save();
    await GameService._log(sessionId, 'STATE_TRANSITION', { targetState: 'lobby', restart: true }, hostId, 'host', session.version);
    await CacheService.invalidateSession(sessionId);
    return session;
  }

  // ─── PUBLIC helpers ───────────────────────────────────────────────────────

  static async getQuestionById(id) { return GameService._getQuestionById(id); }

  // ─── PRIVATE ──────────────────────────────────────────────────────────────

  static async _log(sessionId, action, payload, actorId, actorRole, sequence) {
    GameLog.create({ sessionId, eventId: uuidv4(), sequence, action, actorId: actorId?.toString(), actorRole, payload })
      .catch((e) => logger.error('Log write failed', { err: e.message }));
  }

  static async _getQuestionById(id) {
    if (!id) return null;
    const key = id.toString();
    const cached = await CacheService.getQuestion(key);
    if (cached) return cached;
    const q = await Question.findById(id).lean();
    if (q) await CacheService.setQuestion(key, q);
    return q;
  }

  static _teamColor(idx) {
    return ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6'][idx % 6];
  }
}

module.exports = GameService;
