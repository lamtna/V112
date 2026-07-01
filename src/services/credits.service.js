'use strict';
const mongoose = require('mongoose');
const { Credits, CreditTransaction } = require('../models/Credits');
const logger = require('../config/logger');

class CreditsService {
  static async getOrCreate(userId) {
    let credits = await Credits.findOne({ userId });
    if (!credits) {
      credits = await Credits.create({ userId, balance: 0, plan: 'trial', trialSessionsUsed: 0, trialSessionsMax: 3 });
      await CreditTransaction.create({ userId, type: 'trial', amount: 0, balance: 0, description: 'Trial account created — 3 free sessions' });
    }
    return credits;
  }

  static async canCreateSession(userId) {
    const credits = await CreditsService.getOrCreate(userId);
    return credits.canCreateSession();
  }

  /**
   * Deduct a credit atomically using a MongoDB transaction (if replica set available).
   * Falls back to non-transactional update for standalone Mongo (dev environments).
   */
  static async useCredit(userId, sessionId) {
    const session = await mongoose.startSession().catch(() => null);

    if (session) {
      try {
        let result;
        await session.withTransaction(async () => {
          const credits = await Credits.findOne({ userId }).session(session);
          if (!credits) throw new Error('Credits account not found');
          const check = credits.canCreateSession();
          if (!check.allowed) throw Object.assign(new Error(check.message), { status: 402, code: check.reason });

          if (credits.plan === 'unlimited') {
            credits.totalUsed += 1;
          } else if (credits.plan === 'trial') {
            credits.trialSessionsUsed += 1;
            credits.totalUsed += 1;
          } else {
            credits.balance -= 1;
            credits.totalUsed += 1;
          }
          credits.lastActivityAt = new Date();
          await credits.save({ session });

          await CreditTransaction.create([{
            userId,
            type: credits.plan === 'trial' ? 'trial' : 'usage',
            amount: credits.plan === 'unlimited' ? 0 : -1,
            balance: credits.balance,
            description: credits.plan === 'trial' ? `Trial session ${credits.trialSessionsUsed}/${credits.trialSessionsMax}` : 'Session created',
            sessionId,
          }], { session });

          result = credits;
        });
        return result;
      } catch (err) {
        throw err;
      } finally {
        session.endSession();
      }
    }

    // Fallback — no transaction support (standalone MongoDB without replica set)
    const credits = await Credits.findOne({ userId });
    if (!credits) throw new Error('Credits account not found');
    const check = credits.canCreateSession();
    if (!check.allowed) throw Object.assign(new Error(check.message), { status: 402, code: check.reason });

    if (credits.plan === 'unlimited') { credits.totalUsed += 1; }
    else if (credits.plan === 'trial') { credits.trialSessionsUsed += 1; credits.totalUsed += 1; }
    else { credits.balance -= 1; credits.totalUsed += 1; }
    credits.lastActivityAt = new Date();
    await credits.save();

    await CreditTransaction.create({
      userId,
      type: credits.plan === 'trial' ? 'trial' : 'usage',
      amount: credits.plan === 'unlimited' ? 0 : -1,
      balance: credits.balance,
      description: credits.plan === 'trial' ? `Trial session ${credits.trialSessionsUsed}/${credits.trialSessionsMax}` : 'Session created',
      sessionId,
    });
    return credits;
  }

  static async addCredits(userId, amount, type = 'admin_grant', description = '') {
    if (amount <= 0) throw new Error('Amount must be positive');
    const credits = await CreditsService.getOrCreate(userId);
    credits.balance        += amount;
    credits.totalPurchased += amount;
    await credits.save();
    await CreditTransaction.create({ userId, type, amount, balance: credits.balance, description });
    logger.info('Credits added', { userId, amount, type });
    return credits;
  }

  static async setPlan(userId, plan, expiresAt = null) {
    const credits = await CreditsService.getOrCreate(userId);
    credits.plan = plan;
    if (expiresAt) credits.planExpiresAt = expiresAt;
    await credits.save();
    logger.info('Plan updated', { userId, plan });
    return credits;
  }

  static async getTransactions(userId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      CreditTransaction.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CreditTransaction.countDocuments({ userId }),
    ]);
    return { transactions, total, page, limit };
  }
}

module.exports = CreditsService;
