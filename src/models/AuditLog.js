'use strict';
const mongoose = require('mongoose');

/**
 * AuditLog — security audit trail for sensitive actions.
 */
const auditLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action:     { type: String, required: true },
  resource:   { type: String },
  resourceId: { type: String },
  ip:         { type: String },
  userAgent:  { type: String },
  result:     { type: String, enum: ['success','failure','blocked'], default: 'success' },
  details:    { type: mongoose.Schema.Types.Mixed },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false });

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // keep 90 days

module.exports = mongoose.model('AuditLog', auditLogSchema);
