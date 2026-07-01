'use strict';

require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

module.exports = {
  port: parseInt(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // 🔥 مهم: نفس اسم الموجود في .env
  mongoUri: process.env.MONGODB_URI,

  redisUrl: process.env.REDIS_URL,

  // JWT (مطابق للأسماء في .env عندك)
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),

  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '7d',

  socketThrottleMs: parseInt(process.env.SOCKET_THROTTLE_MS) || 50,
  snapshotInterval: parseInt(process.env.SNAPSHOT_INTERVAL) || 5,

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};