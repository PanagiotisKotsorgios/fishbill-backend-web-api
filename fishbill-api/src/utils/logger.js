/**
 * FishBill — Structured Logger (Winston)
 * - Development: colorized, human-readable console output
 * - Production:  JSON lines to console + rotating log files
 */

'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

const isProd = process.env.NODE_ENV === 'production';

// Ensure logs/ directory exists in production
if (isProd) {
  const logsDir = path.join(__dirname, '../../logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
}

const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  })
);

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'warn' : 'debug'),
  format: isProd ? prodFormat : devFormat,
  transports: [
    new transports.Console(),
    ...(isProd ? [
      new transports.File({
        filename: path.join(__dirname, '../../logs/error.log'),
        level: 'error',
        maxsize: 10 * 1024 * 1024, // 10 MB
        maxFiles: 5,
        tailable: true,
      }),
      new transports.File({
        filename: path.join(__dirname, '../../logs/combined.log'),
        maxsize: 20 * 1024 * 1024, // 20 MB
        maxFiles: 10,
        tailable: true,
      }),
    ] : []),
  ],
  exitOnError: false,
});

// Morgan-compatible write stream for HTTP access logs
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
