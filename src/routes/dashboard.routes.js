const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const dashboardController = require('../controllers/dashboard.controller');

// All routes require authentication
router.use(authenticate);

// Employee dashboard
router.get('/summary', dashboardController.getEmployeeSummary);
router.get('/stats', dashboardController.getEmployeeStats);

// Admin/HR dashboard
router.get('/admin-summary', requirePermission('dashboard:read'), dashboardController.getAdminSummary);
router.get('/admin-stats', requirePermission('dashboard:read'), dashboardController.getAdminStats);
router.get('/admin-governance', requirePermission('dashboard:read'), dashboardController.getAdminGovernance);
router.get('/admin-compliance', requirePermission('dashboard:read'), dashboardController.getAdminCompliance);
router.get('/admin-activity', requirePermission('dashboard:read'), dashboardController.getAdminActivity);

module.exports = router;