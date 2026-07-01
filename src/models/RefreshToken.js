'use strict';
const mongoose = require('mongoose');

/**
 * RefreshToken — supports JWT refresh token rotation.
 * Each token is single-use (rotated on every refresh).
 */
const refreshTokenSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token:     { type: String, required: true, unique: true },
  family:    { type: String, required: true },          // rotation family — reuse detected if same family differs
  revoked:   { type: Boolean, default: false },
  userAgent: { type: String },
  ip:        { type: String },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: false });

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-expire
refreshTokenSchema.index({ userId: 1, revoked: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
