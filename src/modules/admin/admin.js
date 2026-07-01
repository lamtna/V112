'use strict';
const express       = require('express');
const router        = express.Router();
const path          = require('path');
const fs            = require('fs');
const GameSession   = require('../../models/GameSession');
const GameLog       = require('../../models/GameLog');
const Snapshot      = require('../../models/Snapshot');
const Question      = require('../../models/Question');
const User          = require('../../models/User');
const { Credits }   = require('../../models/Credits');
const CacheService  = require('../../services/cache.service');
const CreditsService = require('../../services/credits.service');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const asyncHandler  = require('../../middleware/asyncHandler');
const logger        = require('../../config/logger');

router.use(authenticate, requireRole('admin'));

// ── System stats ──────────────────────────────────────────────────────────

router.get('/stats', asyncHandler(async (req, res) => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalSessions, activeSessions, totalQuestions, totalUsers, recentLogs, categoryStats, difficultyStats, valueStats] = await Promise.all([
    GameSession.countDocuments(),
    GameSession.countDocuments({ state: { $in: ['lobby','playing','question','answer','scoring'] } }),
    Question.countDocuments({ isActive: true }),
    User.countDocuments(),
    GameLog.countDocuments({ timestamp: { $gte: since24h } }),
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$category', count: { $sum: 1 }, avgUsage: { $avg: '$usageCount' } } }, { $sort: { count: -1 } }]),
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$difficulty', count: { $sum: 1 } } }]),
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$value', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  res.json({ success: true, stats: { totalSessions, activeSessions, totalQuestions, totalUsers, recentLogs, categoryStats, difficultyStats, valueStats } });
}));

// ── Sessions ──────────────────────────────────────────────────────────────

router.get('/sessions', asyncHandler(async (req, res) => {
  const page = Math.max(1, +req.query.page || 1), limit = Math.min(50, +req.query.limit || 20);
  const filter = {};
  if (req.query.state) filter.state = req.query.state;
  const [sessions, total] = await Promise.all([
    GameSession.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).populate('hostId','username email').lean(),
    GameSession.countDocuments(filter),
  ]);
  res.json({ success: true, sessions, total, page, limit });
}));

router.post('/sessions/:id/force-finish', asyncHandler(async (req, res) => {
  const session = await GameSession.findByIdAndUpdate(req.params.id, { state: 'finished', finishedAt: new Date() }, { new: true });
  if (!session) return res.status(404).json({ success: false, error: 'Not found' });
  await CacheService.invalidateSession(req.params.id);
  res.json({ success: true, session });
}));

router.delete('/sessions/:id', asyncHandler(async (req, res) => {
  await Promise.all([
    GameSession.findByIdAndDelete(req.params.id),
    GameLog.deleteMany({ sessionId: req.params.id }),
    Snapshot.deleteMany({ sessionId: req.params.id }),
    CacheService.invalidateSession(req.params.id),
  ]);
  res.json({ success: true });
}));

// ── Question duplicates ───────────────────────────────────────────────────

router.get('/questions/duplicates', asyncHandler(async (req, res) => {
  const duplicates = await Question.aggregate([
    { $group: { _id: { category: '$category', text: { $toLower: '$text' } }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  res.json({ success: true, duplicates, total: duplicates.length });
}));

// ── Question stats ────────────────────────────────────────────────────────

router.get('/questions/stats', asyncHandler(async (req, res) => {
  const [byCategory, byDifficulty, byValue] = await Promise.all([
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$category', total: { $sum: 1 }, avgUsage: { $avg: '$usageCount' } } }, { $sort: { total: -1 } }]),
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$difficulty', count: { $sum: 1 } } }]),
    Question.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$value', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  res.json({ success: true, byCategory, byDifficulty, byValue });
}));

// ── Excel Export ──────────────────────────────────────────────────────────
// Returns CSV (Excel-compatible) since xlsx npm package unavailable in restricted env

router.get('/questions/export', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category)   filter.category   = req.query.category;
  if (req.query.difficulty) filter.difficulty  = req.query.difficulty;
  if (req.query.value)      filter.value       = +req.query.value;

  const questions = await Question.find(filter).sort({ category: 1, value: 1 }).lean();

  // Build CSV
  const header  = ['category','value','difficulty','text','answer','hint','timeLimit','isActive'];
  const rows    = questions.map((q) => header.map((h) => {
    const val = String(q[h] ?? '').replace(/"/g, '""');
    return `"${val}"`;
  }).join(','));
  const csv = [header.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="questions-${Date.now()}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel UTF-8
}));

// ── Credits management ────────────────────────────────────────────────────

router.get('/credits', asyncHandler(async (req, res) => {
  const page = Math.max(1, +req.query.page || 1), limit = Math.min(50, +req.query.limit || 20);
  const [credits, total] = await Promise.all([
    Credits.find().skip((page-1)*limit).limit(limit).populate('userId','username email').lean(),
    Credits.countDocuments(),
  ]);
  res.json({ success: true, credits, total, page, limit });
}));

module.exports = { router };
