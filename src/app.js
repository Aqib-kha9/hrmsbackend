const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const corsOptions = require('./config/cors');
const { errorHandler } = require('./middleware/error.middleware');
const routes = require('./routes');
const env = require('./config/env');

const app = express();

// ── Trust Proxy ──
// Required for express-rate-limit when running behind a reverse proxy (like Nginx)
app.set('trust proxy', 1);

// ── Security ──
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// ── CORS ──
app.use(cors(corsOptions));

// ── Rate Limiting ──
// Global limiter — generous for dev/internal use
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,   // raised from 100 → 1000
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Never rate-limit health checks or OPTIONS pre-flight
    return req.method === 'OPTIONS' || req.path === '/health';
  },
});
app.use(limiter);

// Auth-specific limiter — 100 login attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many login attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// Applied only to auth routes (mounted below after route registration)

// ── Body Parsing ──
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Static Files ──
const path = require('path');
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  },
  express.static(path.join(__dirname, '../uploads'))
);

// ── HTTP Request Logging ──
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  stream: { write: (message) => logger.http(message.trim()) },
}));

// ── Health Check ──
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'HRMS Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── API Routes ──
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(apiPrefix, routes);

// ── Frontend Route Redirects (for links accessed via backend port) ──
app.get('/self-onboarding', (req, res) => {
  const frontendUrl = env.FRONTEND_URL || env.APP_URL || 'http://localhost:3000';
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  return res.redirect(`${frontendUrl}/self-onboarding${queryString}`);
});

app.get('/reset-password', (req, res) => {
  const frontendUrl = env.FRONTEND_URL || env.APP_URL || 'http://localhost:3000';
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  return res.redirect(`${frontendUrl}/reset-password${queryString}`);
});

// ── 404 Handler ──
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ── Global Error Handler ──
app.use(errorHandler);

module.exports = app;