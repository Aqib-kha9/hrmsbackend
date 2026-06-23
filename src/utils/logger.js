const winston = require('winston');
const env = require('../config/env');

const { combine, timestamp, printf, colorize } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
  if (stack) {
    // Some errors don't have the message in the stack string or are passed strangely
    return `${timestamp} [${level}]: ${message}\n${stack}`;
  }
  return `${timestamp} [${level}]: ${message}`;
});

const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    logFormat,
  ),
  transports: [
    // Console (colored in development)
    new winston.transports.Console({
      format: combine(colorize(), logFormat),
    }),
    // File — all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // File — errors only
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;