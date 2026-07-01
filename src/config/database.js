'use strict';
const mongoose = require('mongoose');
const Redis    = require('ioredis');
const { mongoUri, redisUrl } = require('./index');
const logger = require('./logger');

let redisClient = null;

async function connectMongo() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS:          45000,
  });
  logger.info('MongoDB connected', { uri: mongoUri.replace(/\/\/.*@/, '//***@') });

  mongoose.connection.on('error',        (err) => logger.error('MongoDB error', { err: err.message }));
  mongoose.connection.on('disconnected', ()    => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected',  ()    => logger.info('MongoDB reconnected'));
}

function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue:   false,
      retryStrategy: (times) => {
        if (times > 5) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect',       ()    => logger.info('Redis connected'));
    redisClient.on('ready',         ()    => logger.debug('Redis ready'));
    redisClient.on('error',         (err) => logger.warn('Redis error', { err: err.message }));
    redisClient.on('reconnecting',  ()    => logger.debug('Redis reconnecting'));
    redisClient.on('end',           ()    => logger.warn('Redis connection ended'));
  }
  return redisClient;
}

async function connectRedis() {
  try {
    await getRedis().connect();
  } catch (err) {
    // Redis is optional — app works without it (slower, no caching)
    logger.warn('Redis unavailable — running without cache/queue', { err: err.message });
  }
}

module.exports = { connectMongo, connectRedis, getRedis };
