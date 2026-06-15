/**
 * ═══════════════════════════════════════════════════════
 *  HRMS — Railway DB Seed Runner
 *
 *  Runs seed_production.js against the live Railway MySQL.
 *
 *  Usage:  node src/seeders/run_seed_railway.js
 *
 *  ⚠️  WARNING: This DROPS and RE-CREATES all tables.
 *      Only run on a fresh/new database!
 * ═══════════════════════════════════════════════════════
 */

const path = require('path');

// ── Railway MySQL credentials ──────────────────────────
// Set these BEFORE anything else so dotenv cannot override them
process.env.DB_HOST = 'thomas.proxy.rlwy.net';
process.env.DB_PORT = '48207';
process.env.DB_NAME = 'railway';
process.env.DB_USER = 'root';
process.env.DB_PASSWORD = 'CSSTLkAlJfdjmFeufQuviQLkQTMFOfHV';
process.env.DB_DIALECT = 'mysql';

// Ensure it runs in production mode (SSL gets enabled for cloud MySQL)
process.env.NODE_ENV = 'production';

// Quiet mode for cleaner output
process.env.DB_LOGGING = 'false';

// ── Run the production seed ────────────────────────────
console.log('🚀 Connecting to Railway MySQL and running production seed...\n');

// The seed file imports models which import database.js which uses env.js.
// Since we set process.env above BEFORE requiring, dotenv will NOT override.
require('./seed_production');