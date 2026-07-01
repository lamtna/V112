'use strict';
const AuthService = require('../services/auth.service');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  const token = header.slice(7).trim();
  if (!token) return res.status(401).json({ success: false, error: 'Empty token' });

  try {
    const payload = AuthService.verifyToken(token);
    req.user = { _id: payload._id, role: payload.role, username: payload.username };
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    res.status(401).json({ success: false, error: message, code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: `Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// Verify the requesting user owns the session resource (by hostId), or is admin
function requireOwnership(getOwnerIdFn) {
  return async (req, res, next) => {
    try {
      const ownerId = await getOwnerIdFn(req);
      if (!ownerId) return res.status(404).json({ success: false, error: 'Resource not found' });
      if (req.user.role === 'admin' || ownerId.toString() === req.user._id.toString()) return next();
      return res.status(403).json({ success: false, error: 'Forbidden — not the owner' });
    } catch (err) { next(err); }
  };
}

module.exports = { authenticate, requireRole, requireOwnership };
