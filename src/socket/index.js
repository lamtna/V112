'use strict';
/**
 * Socket Layer — routing ONLY. Zero business logic.
 * Pattern: socket.on(event) → validate input → call service → io.emit result
 *
 * Phase 5 hardening:
 *  - JWT verified on every connection
 *  - Host ownership verified before every mutating event (via GameService queries scoped to hostId)
 *  - Players cannot trigger host events
 *  - Per-event throttle (50ms) + per-socket global rate limit (20 events/sec burst)
 *  - socketMeta & throttleMap scoped per-server-instance (no module-level leak)
 *  - Duplicate session:join handled gracefully (leaves old room first)
 *  - Multi-tab: each socket connection is independent — multiple tabs = multiple sockets in the same room, all receive broadcasts
 *  - Reconnection: ping:session re-syncs full state after reconnect
 */
const { Server }      = require('socket.io');
const AuthService      = require('../services/auth.service');
const GameService      = require('../modules/game/game.service');
const logger            = require('../config/logger');

const THROTTLE_MS      = parseInt(process.env.SOCKET_THROTTLE_MS) || 50;
const MAX_EVENTS_PER_SEC = 20;

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
      methods: ['GET','POST'],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
    maxHttpBufferSize: 1e5,
  });

  // Per-server-instance state (not module-level — avoids cross-test leakage)
  const socketMeta = new Map(); // socketId → { sessionId, userId, role, roomCode, lastEvents, eventCount, windowStart }
  const rooms      = new Map(); // roomCode → Set<socketId>

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /i, '');
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      socket.user = AuthService.verifyToken(token);
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  function getMeta(socket) { return socketMeta.get(socket.id); }
  function isHost(socket)  { return socket.user.role === 'host' || socket.user.role === 'admin'; }

  // Per-event throttle + global burst limit combined
  function rateLimited(socketId, event) {
    const meta = socketMeta.get(socketId);
    if (!meta) return true;
    const now = Date.now();

    // Per-event throttle
    const lastEvent = meta.lastEvents.get(event) || 0;
    if (now - lastEvent < THROTTLE_MS) return true;
    meta.lastEvents.set(event, now);

    // Global burst limit (sliding 1-second window)
    if (now - meta.windowStart > 1000) {
      meta.windowStart = now;
      meta.eventCount  = 0;
    }
    meta.eventCount += 1;
    if (meta.eventCount > MAX_EVENTS_PER_SEC) return true;

    return false;
  }

  function emitError(socket, message, code = 'ERROR') { socket.emit('error', { message, code }); }
  function handleErr(socket, err, event) {
    logger.warn('Socket handler error', { event, err: err.message, socketId: socket.id });
    emitError(socket, err.message, err.code || 'ERROR');
  }

  io.on('connection', (socket) => {
    logger.debug('Socket connected', { id: socket.id, userId: socket.user._id, role: socket.user.role });

    // ── session:join ──────────────────────────────────────────────────────
    socket.on('session:join', async (data) => {
      try {
        const code = (data?.code || '').trim().toUpperCase();
        if (!code || code.length !== 6) return emitError(socket, 'Invalid session code', 'INVALID_CODE');

        const existingMeta = getMeta(socket);
        if (existingMeta) {
          socket.leave(existingMeta.roomCode);
          rooms.get(existingMeta.roomCode)?.delete(socket.id);
          socketMeta.delete(socket.id);
        }

        const session = await GameService.getSessionByCode(code);
        if (!session) return emitError(socket, 'Session not found', 'NOT_FOUND');

        const roomCode = `room:${code}`;
        socket.join(roomCode);

        socketMeta.set(socket.id, {
          sessionId: session._id.toString(),
          userId: socket.user._id.toString(),
          role: socket.user.role,
          roomCode,
          lastEvents: new Map(),
          eventCount: 0,
          windowStart: Date.now(),
        });

        if (!rooms.has(roomCode)) rooms.set(roomCode, new Set());
        rooms.get(roomCode).add(socket.id);

        socket.emit('session:joined', { session });
        socket.to(roomCode).emit('player:join', { userId: socket.user._id, username: socket.user.username, role: socket.user.role });
        logger.debug('Socket joined room', { id: socket.id, code, role: socket.user.role });
      } catch (err) { handleErr(socket, err, 'session:join'); }
    });

    // ── game:transition (host only) ───────────────────────────────────────
    socket.on('game:transition', async (data) => {
      if (rateLimited(socket.id, 'game:transition')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const session = await GameService.transition(meta.sessionId, data?.targetState, socket.user._id, socket.user.role);
        io.to(meta.roomCode).emit('game:update', { type: 'STATE_CHANGE', state: session.state, version: session.version });
      } catch (err) { handleErr(socket, err, 'game:transition'); }
    });

    // ── question:select (host only) ───────────────────────────────────────
    socket.on('question:select', async (data) => {
      if (rateLimited(socket.id, 'question:select')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const { session, question } = await GameService.selectQuestion(meta.sessionId, socket.user._id, data?.category, data?.value);

        socket.emit('question:show:host', {
          question,
          session: { state: session.state, version: session.version, board: session.board, currentQuestion: session.currentQuestion },
        });

        socket.to(meta.roomCode).emit('question:show', {
          category: question.category,
          value: question.value,
          text: question.text,
          timeLimit: session.currentQuestion.timeLimit,
          state: session.state,
          // Hint shown to players only for $800 questions, and only the hint text — never the answer
          hint: question.value === 800 ? (question.hint || null) : null,
        });
      } catch (err) { handleErr(socket, err, 'question:select'); }
    });

    // ── answer:show (host only) ─────────────────────────────────────────────
    socket.on('answer:show', async () => {
      if (rateLimited(socket.id, 'answer:show')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const { session, question } = await GameService.showAnswer(meta.sessionId, socket.user._id);
        io.to(meta.roomCode).emit('answer:show', { state: session.state, answer: question?.answer || null, hint: question?.hint || null });
      } catch (err) { handleErr(socket, err, 'answer:show'); }
    });

    // ── score:assign (host only) ─────────────────────────────────────────────
    socket.on('score:assign', async (data) => {
      if (rateLimited(socket.id, 'score:assign')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const { session, boardComplete } = await GameService.assignScore(meta.sessionId, socket.user._id, data?.teamId, data?.correct);
        io.to(meta.roomCode).emit('score:update', { teams: session.teams, state: session.state, boardComplete });
      } catch (err) { handleErr(socket, err, 'score:assign'); }
    });

    // ── game:next (host only) ─────────────────────────────────────────────
    socket.on('game:next', async () => {
      if (rateLimited(socket.id, 'game:next')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const session = await GameService.nextQuestion(meta.sessionId, socket.user._id);
        io.to(meta.roomCode).emit('game:update', { type: 'NEXT', state: session.state, board: session.board, version: session.version, finished: session.state === 'finished' });
      } catch (err) { handleErr(socket, err, 'game:next'); }
    });

    // ── game:restart (host only) ───────────────────────────────────────────
    socket.on('game:restart', async () => {
      if (rateLimited(socket.id, 'game:restart')) return;
      const meta = getMeta(socket);
      if (!meta || !isHost(socket)) return emitError(socket, 'Not authorized', 'FORBIDDEN');
      try {
        const session = await GameService.restartSession(meta.sessionId, socket.user._id);
        io.to(meta.roomCode).emit('game:update', { type: 'RESTART', state: session.state, version: session.version, board: session.board, teams: session.teams });
      } catch (err) { handleErr(socket, err, 'game:restart'); }
    });

    // ── ping:session — reconnection health check + full state resync ───────
    socket.on('ping:session', async () => {
      const meta = getMeta(socket);
      if (!meta) return socket.emit('pong:session', { ok: false });
      try {
        const session = await GameService.getSession(meta.sessionId);
        socket.emit('pong:session', { ok: true, state: session?.state, version: session?.version, teams: session?.teams, board: session?.board });
      } catch { socket.emit('pong:session', { ok: false }); }
    });

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const meta = getMeta(socket);
      if (meta) {
        socket.to(meta.roomCode).emit('player:leave', { userId: socket.user._id, username: socket.user.username });
        const roomSet = rooms.get(meta.roomCode);
        if (roomSet) { roomSet.delete(socket.id); if (roomSet.size === 0) rooms.delete(meta.roomCode); }
        socketMeta.delete(socket.id);
      }
      logger.debug('Socket disconnected', { id: socket.id, reason });
    });
  });

  return io;
}

module.exports = initSocket;
