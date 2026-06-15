const env = require('./env');

/**
 * CORS configuration
 * Allows the web panel, mobile app, and Render preview URLs to access the API.
 *
 * CORS_ORIGIN env var should be a comma-separated list of allowed origins.
 * Example: https://hrms-admin.onrender.com,https://yourdomain.com
 *
 * Mobile apps (Flutter) send no Origin header — those are always allowed.
 */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl, health-checks)
    if (!origin) return callback(null, true);

    const allowedOrigins = (env.CORS_ORIGIN || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    // Always allow localhost in development
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    // Always allow any *.onrender.com subdomain (Render preview + production URLs)
    const isRender = /^https:\/\/[a-zA-Z0-9-]+\.onrender\.com$/.test(origin);
    // Always allow any *.vercel.app subdomain (Vercel preview + production URLs)
    const isVercel = /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin);

    if (isLocalhost || isRender || isVercel || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token'],
  exposedHeaders: ['X-Total-Count'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

module.exports = corsOptions;