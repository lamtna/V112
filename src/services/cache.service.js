'use strict';
const { getRedis } = require('../config/database');
const logger = require('../config/logger');

const TTL = {
  session:   3600,   // 1 hour
  question:  86400,  // 24 hours
  questions: 86400,  // 24 hours (category list)
};

/**
 * Safe wrapper — cache failures are non-fatal.
 * All methods return null on error (miss), never throw.
 */
async function safe(fn) {
  try {
    const redis = getRedis();
    if (!redis || redis.status === 'end') return null;
    return await fn(redis);
  } catch (err) {
    logger.warn('Cache operation failed', { err: err.message });
    return null;
  }
}

const CacheService = {
  // ── Session ──────────────────────────────────────────────────────────────
  async getSession(sessionId) {
    return safe(async (r) => {
      const data = await r.get(`session:${sessionId}`);
      return data ? JSON.parse(data) : null;
    });
  },

  async setSession(sessionId, session) {
    return safe((r) => r.setex(`session:${sessionId}`, TTL.session, JSON.stringify(session)));
  },

  async invalidateSession(sessionId) {
    return safe((r) => r.del(`session:${sessionId}`));
  },

  // ── Single question ───────────────────────────────────────────────────────
  async getQuestion(questionId) {
    return safe(async (r) => {
      const data = await r.get(`question:${questionId}`);
      return data ? JSON.parse(data) : null;
    });
  },

  async setQuestion(questionId, question) {
    return safe((r) => r.setex(`question:${questionId}`, TTL.question, JSON.stringify(question)));
  },

  // ── Category question list ────────────────────────────────────────────────
  async getQuestions(category) {
    return safe(async (r) => {
      const data = await r.get(`questions:${category}`);
      return data ? JSON.parse(data) : null;
    });
  },

  async setQuestions(category, questions) {
    return safe((r) => r.setex(`questions:${category}`, TTL.questions, JSON.stringify(questions)));
  },

  async invalidateQuestions(category) {
    return safe((r) => r.del(`questions:${category}`));
  },

  // ── Generic ───────────────────────────────────────────────────────────────
  async set(key, value, ttl = 300) {
    return safe((r) => r.setex(key, ttl, JSON.stringify(value)));
  },

  async get(key) {
    return safe(async (r) => {
      const data = await r.get(key);
      return data ? JSON.parse(data) : null;
    });
  },

  async del(key) {
    return safe((r) => r.del(key));
  },
};

module.exports = CacheService;
