'use strict';
const Snapshot = require('../../models/Snapshot');
const GameLog  = require('../../models/GameLog');
const logger   = require('../../config/logger');
const { snapshotInterval } = require('../../config');

class GameSnapshot {
  static async save(session, logSequence) {
    try {
      const sessionObj = session.toObject ? session.toObject() : session;
      const snap = await Snapshot.create({
        sessionId: sessionObj._id,
        version:   sessionObj.version,
        state:     sessionObj.state,
        logSequence,
        fullGameState: {
          state:           sessionObj.state,
          version:         sessionObj.version,
          teams:           sessionObj.teams,
          board:           sessionObj.board,
          categories:      sessionObj.categories,
          currentQuestion: sessionObj.currentQuestion,
          locked:          sessionObj.locked,
        },
      });
      logger.debug('Snapshot saved', { sessionId: sessionObj._id, version: sessionObj.version });
      return snap;
    } catch (err) {
      logger.error('Snapshot save failed', { err: err.message });
      throw err;
    }
  }

  static async getLatest(sessionId) {
    return Snapshot.findOne({ sessionId }).sort({ version: -1 }).lean();
  }

  static async getLogsSince(sessionId, fromSequence) {
    return GameLog.find({ sessionId, sequence: { $gt: fromSequence } })
      .sort({ sequence: 1 })
      .lean();
  }

  static shouldSnapshot(version) {
    return version > 0 && version % snapshotInterval === 0;
  }
}

module.exports = GameSnapshot;
