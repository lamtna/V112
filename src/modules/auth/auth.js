'use strict';
/**
 * Auth Controller — thin routing layer only.
 * Business logic lives in services/auth.service.js (breaks circular dependency
 * with middleware/auth.middleware.js, which needs AuthService.verifyToken()).
 */
const express      = require('express');
const router       = express.Router();
const AuthService  = require('../../services/auth.service');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const asyncHandler = require('../../middleware/asyncHandler');

function meta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username?.trim() || !email || !password) {
    return res.status(400).json({ success: false, error: 'username, email and password required' });
  }
  if (password.length < 8) return res.status(400).json({ success: false, error: 'Password min 8 characters' });
  const result = await AuthService.register(username, email, password, role);
  res.status(201).json({ success: true, ...result });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const result = await AuthService.login(req.body.email, req.body.password, meta(req));
  const { refreshToken, ...rest } = result;
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   30 * 24 * 60 * 60 * 1000,
    path:     '/api/auth/refresh',
  });
  res.json({ success: true, ...rest });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  const result = await AuthService.refresh(token, meta(req));
  const { refreshToken, ...rest } = result;
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   30 * 24 * 60 * 60 * 1000,
    path:     '/api/auth/refresh',
  });
  res.json({ success: true, ...rest });
}));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  await AuthService.logout(token);
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ success: true });
}));

router.post('/logout-all', authenticate, asyncHandler(async (req, res) => {
  await AuthService.logoutAll(req.user._id);
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ success: true });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await AuthService.getProfile(req.user._id);
  res.json({ success: true, user });
}));

router.get('/users', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = await AuthService.listUsers(req.query);
  res.json({ success: true, ...result });
}));

router.patch('/users/:id', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const user = await AuthService.updateUser(req.params.id, req.body, req.user.role);
  res.json({ success: true, user });
}));

router.delete('/users/:id', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  await AuthService.deleteUser(req.params.id);
  res.json({ success: true });
}));

module.exports = { router, AuthService };
