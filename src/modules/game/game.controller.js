'use strict';
const express     = require('express');
const router      = express.Router();
const GameService   = require('./game.service');
const GameRecovery  = require('./game.recovery');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validate.middleware');
const asyncHandler  = require('../../middleware/asyncHandler');

router.use(authenticate);

// ── Session CRUD ──────────────────────────────────────────────────────────

router.post('/', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const session = await GameService.createSession(req.user._id, req.body.settings || {});
  res.status(201).json({ success: true, session });
}));

router.get('/', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const result = await GameService.listSessions(req.user._id, req.query);
  res.json({ success: true, ...result });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const session = await GameService.getSession(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, session });
}));

router.get('/code/:code', asyncHandler(async (req, res) => {
  const session = await GameService.getSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, session });
}));

router.patch('/:id/settings', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const session = await GameService.updateSettings(req.params.id, req.user._id, req.body);
  res.json({ success: true, session });
}));

router.delete('/:id', requireRole('host','admin'), asyncHandler(async (req, res) => {
  await GameService.deleteSession(req.params.id, req.user._id, req.user.role);
  res.json({ success: true });
}));

// ── Teams ─────────────────────────────────────────────────────────────────

router.post('/:id/teams', requireRole('host','admin'), validate('addTeam'), asyncHandler(async (req, res) => {
  const team = await GameService.addTeam(req.params.id, req.user._id, req.body.name);
  res.status(201).json({ success: true, team });
}));

router.delete('/:id/teams/:teamId', requireRole('host','admin'), asyncHandler(async (req, res) => {
  await GameService.removeTeam(req.params.id, req.user._id, req.params.teamId);
  res.json({ success: true });
}));

// ── Categories ────────────────────────────────────────────────────────────

router.post('/:id/categories', requireRole('host','admin'), validate('selectCategories'), asyncHandler(async (req, res) => {
  const board = await GameService.selectCategories(req.params.id, req.user._id, req.body.categories);
  res.json({ success: true, board });
}));

// ── Game flow ─────────────────────────────────────────────────────────────

router.post('/:id/transition', requireRole('host','admin'), validate('transition'), asyncHandler(async (req, res) => {
  const session = await GameService.transition(req.params.id, req.body.targetState, req.user._id, req.user.role);
  res.json({ success: true, session });
}));

router.post('/:id/question', requireRole('host','admin'), validate('selectQuestion'), asyncHandler(async (req, res) => {
  const { category, value } = req.body;
  const result = await GameService.selectQuestion(req.params.id, req.user._id, category, value);
  res.json({ success: true, ...result });
}));

router.post('/:id/answer', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const result = await GameService.showAnswer(req.params.id, req.user._id);
  res.json({ success: true, ...result });
}));

router.post('/:id/score', requireRole('host','admin'), validate('assignScore'), asyncHandler(async (req, res) => {
  const { teamId, correct } = req.body;
  const result = await GameService.assignScore(req.params.id, req.user._id, teamId, correct);
  res.json({ success: true, ...result });
}));

router.post('/:id/next', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const session = await GameService.nextQuestion(req.params.id, req.user._id);
  res.json({ success: true, session });
}));

// ── Restart (re-shuffle board, reset scores, back to lobby) ──────────────

router.post('/:id/restart', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const session = await GameService.restartSession(req.params.id, req.user._id);
  res.json({ success: true, session });
}));

// ── Recovery ──────────────────────────────────────────────────────────────

router.get('/:id/recover', requireRole('host','admin'), asyncHandler(async (req, res) => {
  const recovered = await GameRecovery.rebuildSession(req.params.id);
  if (!recovered) return res.status(404).json({ success: false, error: 'No snapshot found for recovery' });
  res.json({ success: true, recovered });
}));

router.post('/:id/recover/apply', requireRole('admin'), asyncHandler(async (req, res) => {
  const result = await GameRecovery.applyRecovery(req.params.id);
  res.json({ success: true, ...result });
}));

module.exports = router;
