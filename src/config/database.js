'use strict';

const mongoose = require('mongoose');
const Redis = require('ioredis');
const { mongoUri, redisUrl } = require('./index');
const logger = require('./logger');

let redisClient = null;

/* ─────────────────────── MongoDB ─────────────────────── */
async function connectMongo() {
  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  logger.info('MongoDB connected', {
    uri: mongoUri.replace(/\/\/.*@/, '//***@')
  });

  mongoose.connection.on('error', (err) =>
    logger.error('MongoDB error', { err: err.message })
  );

  mongoose.connection.on('disconnected', () =>
    logger.warn('MongoDB disconnected')
  );

  mongoose.connection.on('reconnected', () =>
    logger.info('MongoDB reconnected')
  );
}

/* ─────────────────────── Redis ─────────────────────── */
function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,

      // 🔥 مهم جداً لـ Upstash
      maxRetriesPerRequest: null,
      enableReadyCheck: false,

      // 🔥 TLS fix (سبب المشكلة عندك)
      tls: {}
    });

    redisClient.on('connect', () =>
      logger.info('Redis connecting...')
    );

    redisClient.on('ready', () =>
      logger.info('Redis ready')
    );

    redisClient.on('error', (err) =>
      logger.warn('Redis error', { err: err.message })
    );

    redisClient.on('reconnecting', () =>
      logger.debug('Redis reconnecting')
    );

    redisClient.on('end', () =>
      logger.warn('Redis connection ended')
    );
  }

  return redisClient;
}

/* ─────────────────────── Connect Redis ─────────────────────── */
async function connectRedis() {
  try {
    await getRedis().connect();
  } catch (err) {
    logger.warn('Redis unavailable — running without cache/queue', {
      err: err.message
    });
  }
}

module.exports = {
  connectMongo,
  connectRedis,
  getRedis
};