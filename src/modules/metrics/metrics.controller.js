'use strict';
const express     = require('express');
const router      = express.Router();
const mongoose    = require('mongoose');
const { getRedis } = require('../../config/database');
const GameSession = require('../../models/GameSession');
const logger      = require('../../config/logger');

// Prometheus-style metrics (text/plain for scraping, JSON for dashboard)
router.get('/', async (req, res) => {
  try {
    const [activeSessions, totalSessions] = await Promise.all([
      GameSession.countDocuments({ state: { $in: ['lobby','playing','question','answer','scoring'] } }),
      GameSession.countDocuments(),
    ]);

    let redisConnected = false;
    try { const r = getRedis(); redisConnected = r.status === 'ready'; } catch {}

    const metrics = {
      uptime_seconds:     process.uptime(),
      memory_heap_mb:     (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
      memory_rss_mb:      (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
      mongo_connected:    mongoose.connection.readyState === 1,
      redis_connected:    redisConnected,
      active_sessions:    activeSessions,
      total_sessions:     totalSessions,
      node_version:       process.version,
      timestamp:          new Date().toISOString(),
    };

    // Accept header determines format
    if (req.headers.accept?.includes('text/plain')) {
      const lines = Object.entries(metrics).map(([k, v]) => `quizgame_${k} ${v}`);
      return res.type('text/plain').send(lines.join('\n'));
    }

    res.json({ success: true, metrics });
  } catch (err) {
    logger.error('Metrics error', { err: err.message });
    res.status(500).json({ success: false });
  }
});

module.exports = router;
