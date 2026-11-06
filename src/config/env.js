/**
 * Environment configuration
 * Validates and exposes all env vars with defaults
 */
const env = {
  // Server
  NODE_ENV: (process.env.NODE_ENV && process.env.NODE_ENV.trim()) || 'development',
  PORT: parseInt(process.env.PORT) || 5000,
  API_PREFIX: process.env.API_PREFIX || '/api/v1',
  APP_URL: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000',
  BACKEND_URL: process.env.BACKEND_URL || `http://localhost:${parseInt(process.env.PORT) || 5000}`,

  // Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT) || 3306,
  DB_NAME: process.env.DB_NAME || 'hrms_db',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_DIALECT: process.env.DB_DIALECT || 'mysql',
  DB_LOGGING: process.env.DB_LOGGING === 'true',
  DB_SYNC_FORCE: process.env.DB_SYNC_FORCE === 'true',
  DB_SSL: process.env.DB_SSL === 'true',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'change_this_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '60d',

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 100,

  // Google Maps
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Cloudinary has been removed in favor of local storage
  // SMTP (Brevo / Sendinblue)
  SMTP_HOST: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
};

module.exports = env;