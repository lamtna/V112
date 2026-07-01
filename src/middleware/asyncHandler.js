// asyncHandler.js — wraps async route handlers so errors propagate to express error handler
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
