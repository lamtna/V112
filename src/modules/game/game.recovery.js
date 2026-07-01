'use strict';
const GameSnapshot = require('./game.snapshot');
const GameEngine   = require('./game.engine');
const GameSession  = require('../../models/GameSession');
const logger       = require('../../config/logger');

class GameRecovery {
  /**
   * Rebuild full session state from latest snapshot + subsequent event logs.
   * READ-ONLY — does not write to the database. Use applyRecovery() to persist.
   */
  static async rebuildSession(sessionId) {
    const snapshot = await GameSnapshot.getLatest(sessionId);
    if (!snapshot) {
      logger.warn('No snapshot found for recovery', { sessionId });
      return null;
    }

    const logs = await GameSnapshot.getLogsSince(sessionId, snapshot.logSequence);
    logger.info('Replaying events for recovery', { sessionId, snapshotVersion: snapshot.version, logsToReplay: logs.length });

    const recovered = GameEngine.replay(snapshot.fullGameState, logs);
    return {
      ...recovered,
      _id: sessionId,
      recoveredAt: new Date(),
      recoveredFromVersion: snapshot.version,
      appliedLogs: logs.length,
    };
  }

  /**
   * Rebuild AND persist the recovered state back to the live GameSession document.
   * Used after a crash to restore a session to its last known-consistent state.
   */
  static async applyRecovery(sessionId) {
    const recovered = await GameRecovery.rebuildSession(sessionId);
    if (!recovered) throw Object.assign(new Error('No snapshot available for recovery'), { status: 404 });

    const session = await GameSession.findById(sessionId);
    if (!session) throw Object.assign(new Error('Session document not found'), { status: 404 });

    session.state           = recovered.state;
    session.version         = recovered.version;
    session.teams           = recovered.teams;
    session.board           = recovered.board;
    session.categories      = recovered.categories;
    session.currentQuestion = recovered.currentQuestion;
    session.locked          = recovered.locked;

    await session.save();
    logger.info('Recovery applied', { sessionId, restoredVersion: recovered.version, appliedLogs: recovered.appliedLogs });

    return { session, appliedLogs: recovered.appliedLogs, restoredFromVersion: recovered.recoveredFromVersion };
  }

  /**
   * Check whether the live session version matches what event replay would produce.
   */
  static async validateConsistency(sessionId, currentVersion) {
    const snapshot = await GameSnapshot.getLatest(sessionId);
    if (!snapshot) return true;
    const logs = await GameSnapshot.getLogsSince(sessionId, snapshot.logSequence);
    const expected = snapshot.version + logs.length;
    const inSync = expected === currentVersion;
    if (!inSync) logger.warn('Version drift detected', { sessionId, expected, actual: currentVersion, drift: currentVersion - expected });
    return inSync;
  }

  /**
   * Find and recover abandoned sessions (no activity for 30+ minutes, not finished).
   * Intended to be run periodically (cron / setInterval).
   */
  static async recoverAbandonedSessions(thresholdMinutes = 30) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const abandoned = await GameSession.find({
      state: { $in: ['lobby','playing','question','answer','scoring'] },
      updatedAt: { $lt: threshold },
    }).lean();

    logger.info('Checking for abandoned sessions', { found: abandoned.length });

    const results = [];
    for (const sess of abandoned) {
      try {
        await GameSession.findByIdAndUpdate(sess._id, { state: 'finished', finishedAt: new Date(), abandonedAt: new Date() });
        results.push({ sessionId: sess._id, code: sess.code, action: 'auto-finished' });
        logger.info('Auto-finished abandoned session', { sessionId: sess._id, code: sess.code });
      } catch (err) {
        logger.error('Failed to handle abandoned session', { sessionId: sess._id, err: err.message });
      }
    }
    return results;
  }
}

module.exports = GameRecovery;
