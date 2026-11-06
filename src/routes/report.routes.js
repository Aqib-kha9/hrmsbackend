const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const reportController = require('../controllers/report.controller');

// All report routes require authentication + admin/hr/manager role
router.use(authenticate);
router.use(requirePermission('reports:read'));

// ── Dropdown data ──
router.get('/cycles', reportController.getAvailableCycles);
router.get('/offices', reportController.getOfficeList);

// ── Individual report views ──
router.get('/payroll', reportController.getPayrollReport);
router.get('/attendance', reportController.getAttendanceReport);
router.get('/statutory', reportController.getStatutoryReport);
router.get('/branch', reportController.getBranchReport);
router.get('/tour-expenses', reportController.getTourExpenseReport);

// ── Combined full report ──
router.get('/full', reportController.getFullReport);

module.exports = router;