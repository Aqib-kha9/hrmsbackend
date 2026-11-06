/**
 * Unified Role & Permission Middleware
 * Wraps fine-grained RBAC and provides backward-compatible authorize / selfOrAdmin
 */
const rbac = require('./rbac.middleware');

module.exports = {
  ...rbac,
  authorize: rbac.requireRole,
  selfOrAdmin: rbac.selfOrAdmin,
};