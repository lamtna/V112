'use strict';
const express        = require('express');
const router         = express.Router();
const CreditsService = require('../../services/credits.service');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const asyncHandler   = require('../../middleware/asyncHandler');

router.use(authenticate);

// Get my credits
router.get('/me', asyncHandler(async (req, res) => {
  const credits = await CreditsService.getOrCreate(req.user._id);
  res.json({ success: true, credits });
}));

// My transaction history
router.get('/me/transactions', asyncHandler(async (req, res) => {
  const result = await CreditsService.getTransactions(req.user._id, req.query);
  res.json({ success: true, ...result });
}));

// Admin: get credits for any user
router.get('/:userId', requireRole('admin'), asyncHandler(async (req, res) => {
  const credits = await CreditsService.getOrCreate(req.params.userId);
  res.json({ success: true, credits });
}));

// Admin: grant credits
router.post('/:userId/grant', requireRole('admin'), asyncHandler(async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || +amount <= 0) return res.status(400).json({ success: false, error: 'amount must be positive' });
  const credits = await CreditsService.addCredits(req.params.userId, +amount, 'admin_grant', description);
  res.json({ success: true, credits });
}));

// Admin: set plan
router.post('/:userId/plan', requireRole('admin'), asyncHandler(async (req, res) => {
  const { plan, expiresAt } = req.body;
  const valid = ['trial','basic','pro','unlimited'];
  if (!valid.includes(plan)) return res.status(400).json({ success: false, error: `plan must be one of: ${valid.join(',')}` });
  const credits = await CreditsService.setPlan(req.params.userId, plan, expiresAt);
  res.json({ success: true, credits });
}));

module.exports = { router };
