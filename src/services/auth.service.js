'use strict';
const crypto       = require('crypto');
const jwt          = require('jsonwebtoken');
const User         = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const CreditsService = require('./credits.service');
const AuditService   = require('./audit.service');
const { jwtSecret, jwtExpiresIn, jwtRefreshSecret, jwtRefreshExpires } = require('../config');
const logger       = require('../config/logger');

const REFRESH_SECRET    = jwtRefreshSecret;
const REFRESH_EXPIRES   = jwtRefreshExpires;
const SELF_REGISTER_ROLES = ['host', 'player'];

class AuthService {
  // ── Register ──────────────────────────────────────────────────────────────

  static async register(username, email, password, requestedRole = 'player') {
    const role = SELF_REGISTER_ROLES.includes(requestedRole) ? requestedRole : 'player';

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existing) throw Object.assign(new Error('Username or email already taken'), { status: 409 });

    const user = await User.create({ username: username.trim(), email: email.toLowerCase(), password, role });

    // Initialize credits (trial account)
    await CreditsService.getOrCreate(user._id);

    await AuditService.log({ userId: user._id, action: 'REGISTER', resource: 'user', result: 'success' });
    logger.info('User registered', { userId: user._id, role });
    return AuthService._authResponse(user);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  static async login(email, password, meta = {}) {
    if (!email || !password) throw Object.assign(new Error('Email and password required'), { status: 400 });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      await AuditService.log({ action: 'LOGIN_FAILED', resource: 'user', result: 'failure', details: { email }, ip: meta.ip });
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }
    if (!user.isActive) throw Object.assign(new Error('Account disabled'), { status: 403 });

    user.lastLogin = new Date();
    await user.save();

    const refreshToken = await AuthService._createRefreshToken(user._id, meta);
    await AuditService.log({ userId: user._id, action: 'LOGIN', resource: 'user', result: 'success', ip: meta.ip });
    logger.info('User login', { userId: user._id, role: user.role });

    return { ...AuthService._authResponse(user), refreshToken };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  static async refresh(token, meta = {}) {
    if (!token) throw Object.assign(new Error('Refresh token required'), { status: 401 });

    let payload;
    try {
      payload = jwt.verify(token, REFRESH_SECRET);
    } catch {
      throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });
    }

    const stored = await RefreshToken.findOne({ token, revoked: false });
    if (!stored) {
      // Possible token reuse — revoke entire family
      await RefreshToken.updateMany({ family: payload.family }, { revoked: true });
      await AuditService.log({ userId: payload._id, action: 'REFRESH_REUSE_DETECTED', result: 'blocked' });
      throw Object.assign(new Error('Token reuse detected — please login again'), { status: 401 });
    }

    // Rotate: revoke old, issue new
    stored.revoked = true;
    await stored.save();

    const user = await User.findById(payload._id);
    if (!user || !user.isActive) throw Object.assign(new Error('User not found or disabled'), { status: 401 });

    const newRefresh = await AuthService._createRefreshToken(user._id, meta, payload.family);
    return { ...AuthService._authResponse(user), refreshToken: newRefresh };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  static async logout(refreshToken) {
    if (!refreshToken) return;
    try {
      const payload = jwt.verify(refreshToken, REFRESH_SECRET);
      // Revoke all tokens in this family (all devices logout)
      await RefreshToken.updateMany({ family: payload.family }, { revoked: true });
    } catch {
      // Token already invalid — OK
    }
  }

  // ── Logout all devices ────────────────────────────────────────────────────

  static async logoutAll(userId) {
    await RefreshToken.updateMany({ userId, revoked: false }, { revoked: true });
    logger.info('All sessions revoked', { userId });
  }

  // ── Profile / CRUD ────────────────────────────────────────────────────────

  static async getProfile(userId) {
    const user = await User.findById(userId).lean();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return user;
  }

  static async listUsers({ page = 1, limit = 20 } = {}) {
    const p = Math.max(1, +page), l = Math.min(100, +limit);
    const [users, total] = await Promise.all([
      User.find().skip((p - 1) * l).limit(l).lean(),
      User.countDocuments(),
    ]);
    return { users, total, page: p, limit: l };
  }

  static async updateUser(userId, updates, requestorRole) {
    const allowed = ['username', 'email', 'isActive'];
    if (requestorRole === 'admin' && updates.role && ['admin','host','player'].includes(updates.role)) allowed.push('role');
    const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
    if (filtered.email) filtered.email = filtered.email.toLowerCase();
    const user = await User.findByIdAndUpdate(userId, filtered, { new: true, runValidators: true }).lean();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    return user;
  }

  static async deleteUser(userId) {
    const user = await User.findByIdAndDelete(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    await RefreshToken.deleteMany({ userId });
  }

  // ── Token utilities ───────────────────────────────────────────────────────

  static verifyToken(token) {
    return jwt.verify(token, jwtSecret);
  }

  static _sign(user) {
    return jwt.sign(
      { _id: user._id.toString(), role: user.role, username: user.username },
      jwtSecret,
      { expiresIn: jwtExpiresIn, issuer: 'quizgame' }
    );
  }

  static async _createRefreshToken(userId, meta = {}, family = null) {
    const tokenFamily = family || crypto.randomUUID();
    const tokenValue  = crypto.randomBytes(40).toString('hex');
    const expiresAt   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const payload = { _id: userId.toString(), family: tokenFamily };
    const signed  = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });

    await RefreshToken.create({
      userId,
      token:     signed,
      family:    tokenFamily,
      userAgent: meta.userAgent?.slice(0, 200),
      ip:        meta.ip,
      expiresAt,
    });

    return signed;
  }

  static _authResponse(user) {
    return { user: user.toSafeObject ? user.toSafeObject() : user, token: AuthService._sign(user) };
  }
}

module.exports = AuthService;
