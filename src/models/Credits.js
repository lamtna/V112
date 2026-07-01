'use strict';
const mongoose = require('mongoose');

/**
 * Credits — SaaS usage tracking per user/organization.
 * Each session costs 1 credit. Trial users get 3 free sessions.
 */
const creditsSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance:        { type: Number, default: 0, min: 0 },
  totalPurchased: { type: Number, default: 0 },
  totalUsed:      { type: Number, default: 0 },
  plan:           { type: String, enum: ['trial','basic','pro','unlimited'], default: 'trial' },
  trialSessionsUsed: { type: Number, default: 0 },
  trialSessionsMax:  { type: Number, default: 3 },
  planExpiresAt:  { type: Date },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });

creditsSchema.index({ userId: 1 });

creditsSchema.methods.canCreateSession = function () {
  if (this.plan === 'unlimited') return { allowed: true };
  if (this.plan === 'trial') {
    if (this.trialSessionsUsed < this.trialSessionsMax) {
      return { allowed: true, reason: 'trial', remaining: this.trialSessionsMax - this.trialSessionsUsed };
    }
    return { allowed: false, reason: 'trial_expired', message: 'Trial limit reached. Upgrade to continue.' };
  }
  if (this.balance > 0) return { allowed: true, balance: this.balance };
  return { allowed: false, reason: 'no_credits', message: 'No credits remaining. Purchase credits to continue.' };
};

const CreditTransaction = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:        { type: String, enum: ['purchase','usage','refund','trial','admin_grant'], required: true },
  amount:      { type: Number, required: true },
  balance:     { type: Number, required: true }, // balance AFTER transaction
  description: { type: String },
  sessionId:   { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession' },
  createdAt:   { type: Date, default: Date.now },
}, { timestamps: false });

CreditTransaction.index({ userId: 1, createdAt: -1 });

module.exports = {
  Credits: mongoose.model('Credits', creditsSchema),
  CreditTransaction: mongoose.model('CreditTransaction', CreditTransaction),
};
