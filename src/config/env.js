require('dotenv').config();

const requiredEnv = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET'
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGODB_URI,
  jwtAccess: process.env.JWT_ACCESS_SECRET,
  jwtRefresh: process.env.JWT_REFRESH_SECRET,
};