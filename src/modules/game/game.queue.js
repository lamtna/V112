'use strict';
/**
 * GameQueue — per-session Bull queue for sequential event processing.
 *
 * If Redis is unavailable, falls back to direct execution (no queue).
 * This ensures the app works in development without Redis.
 */
const logger = require('../../config/logger');
const { redisUrl } = require('../../config');

let Bull;
try { Bull = require('bull'); } catch { Bull = null; }

const queues = new Map();

function getQueue(sessionId) {
  if (!Bull) return null;
  if (!queues.has(sessionId)) {
    try {
      const q = new Bull(`game:${sessionId}`, redisUrl, {
        defaultJobOptions: {
          removeOnComplete: 50,
          removeOnFail: 20,
          attempts: 2,
          backoff: { type: 'fixed', delay: 500 },
        },
      });
      q.on('failed', (job, err) => {
        logger.error('Queue job failed', { sessionId, jobId: job.id, err: err.message });
      });
      queues.set(sessionId, q);
    } catch (err) {
      logger.warn('Could not create Bull queue — falling back to direct execution', { err: err.message });
      return null;
    }
  }
  return queues.get(sessionId) || null;
}

class GameQueue {
  /**
   * Enqueue a game action.
   * If Bull/Redis unavailable, executes handler directly (sequential in process).
   */
  static async enqueue(sessionId, action, payload, handler) {
    const queue = getQueue(sessionId);

    if (!queue) {
      // Fallback: direct execution
      return handler({ action, payload, sessionId });
    }

    if (!queue._processorRegistered) {
      queue.process(async (job) => handler(job.data));
      queue._processorRegistered = true;
    }

    const job = await queue.add({ action, payload, sessionId });
    return job.finished();
  }

  static async destroy(sessionId) {
    const queue = queues.get(sessionId);
    if (queue) {
      await queue.close().catch(() => {});
      queues.delete(sessionId);
    }
  }

  static async getDepth(sessionId) {
    const queue = queues.get(sessionId);
    if (!queue) return 0;
    try {
      const counts = await queue.getJobCounts();
      return counts.waiting + counts.active;
    } catch { return 0; }
  }
}

module.exports = GameQueue;
