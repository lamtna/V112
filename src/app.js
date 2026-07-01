'use strict';
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const compression  = require('compression');
const logger       = require('./config/logger');

const { router: authRouter }      = require('./modules/auth/auth');
const gameRouter                  = require('./modules/game/game.controller');
const { router: questionsRouter } = require('./modules/questions/questions');
const { router: adminRouter }     = require('./modules/admin/admin');
const { router: creditsRouter }   = require('./modules/credits/credits.controller');
const metricsRouter               = require('./modules/metrics/metrics.controller');

const ALLOWED_ORIGINS = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
  : ['http://localhost:3000'];

function createApp() {
  const app = express();

  // ── Compression ────────────────────────────────────────────────────────
  app.use(compression());

  // ── Trust proxy (for correct IP behind nginx/load balancer) ───────────
  app.set('trust proxy', 1);

  // ── Security headers ───────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", ...ALLOWED_ORIGINS],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // ── CORS ───────────────────────────────────────────────────────────────
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server
      if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production') return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
    exposedHeaders: ['X-Request-ID','X-RateLimit-Remaining'],
  }));

  // ── Body parsing ────────────────────────────────────────────────────────
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());

  // ── NoSQL injection sanitization ───────────────────────────────────────
  app.use(mongoSanitize({ replaceWith: '_', allowDots: false }));

  // ── Request ID ────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || require('crypto').randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
  });

  // ── Rate limiting ──────────────────────────────────────────────────────
  app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many auth attempts — try again later' } }));
  app.use('/api',      rateLimit({ windowMs: 60*1000,    max: 300, standardHeaders: true, legacyHeaders: false }));

  // ── Health + Metrics ───────────────────────────────────────────────────
  app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV, version: process.env.npm_package_version || '1.0.0' }));
  app.use('/metrics', metricsRouter);

  // ── Routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth',      authRouter);
  app.use('/api/games',     gameRouter);
  app.use('/api/questions', questionsRouter);
  app.use('/api/admin',     adminRouter);
  app.use('/api/credits',   creditsRouter);

  // ── 404 ────────────────────────────────────────────────────────────────
  app.use((req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

  // ── Global error handler ───────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.message?.startsWith('CORS')) return res.status(403).json({ success: false, error: err.message });
    logger.error('Unhandled error', { err: err.message, url: req.url, method: req.method, reqId: req.id });
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      error: (process.env.NODE_ENV === 'production' && status === 500) ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

module.exports = createApp;
