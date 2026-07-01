const winston = require('winston');
const { nodeEnv } = require('../config');

const logger = winston.createLogger({
  level: nodeEnv === 'production' ? 'warn' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message} ${extras}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
