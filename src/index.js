'use strict';
const http        = require('http');
const createApp   = require('./app');
const initSocket  = require('./socket');
const { connectMongo, connectRedis } = require('./config/database');
const GameRecovery = require('./modules/game/game.recovery');
const { port }    = require('./config');
const logger      = require('./config/logger');

async function start() {
  try {
    await connectMongo();
    await connectRedis();
  } catch (err) {
    logger.error('Fatal startup error', { err: err.message });
    process.exit(1);
  }

  const app    = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(port, () => {
    logger.info('QuizGame API running', { port, env: process.env.NODE_ENV || 'development' });
  });

  // ── Background job: auto-finish abandoned sessions every 10 minutes ──────
  const abandonedCheckInterval = setInterval(() => {
    GameRecovery.recoverAbandonedSessions(30).catch((err) =>
      logger.error('Abandoned session check failed', { err: err.message })
    );
  }, 10 * 60 * 1000);
  abandonedCheckInterval.unref();

  // ── Graceful shutdown ────────────────────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — graceful shutdown`);

    server.close(async (err) => {
      if (err) { logger.error('Server close error', { err: err.message }); }
      try {
        const mongoose = require('mongoose');
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');
      } catch {}
      logger.info('Shutdown complete');
      process.exit(err ? 1 : 0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after 15s');
      process.exit(1);
    }, 15000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err) => { logger.error('Uncaught exception',  { err: err.message, stack: err.stack }); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection', { reason: String(reason) }); process.exit(1); });
}

start();
