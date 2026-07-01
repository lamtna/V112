'use strict';
const AuditLog = require('../models/AuditLog');
const logger   = require('../config/logger');

const AuditService = {
  async log(data) {
    try {
      await AuditLog.create(data);
    } catch (err) {
      logger.error('Audit log write failed', { err: err.message });
    }
  },

  middleware(action, resource) {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        AuditService.log({
          userId:    req.user?._id,
          action,
          resource,
          resourceId: req.params?.id,
          ip:        req.ip || req.connection?.remoteAddress,
          userAgent: req.headers?.['user-agent']?.slice(0, 200),
          result:    res.statusCode < 400 ? 'success' : 'failure',
          details:   { status: res.statusCode, duration: Date.now() - start },
        }).catch(() => {});
      });
      next();
    };
  },
};

module.exports = AuditService;
