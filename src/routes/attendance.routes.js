const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { punchInSchema, punchOutSchema, monthlyQuerySchema, manualEntrySchema, adminLiveQuerySchema, adminHistoryQuerySchema, adminMonthlyQuerySchema, markTourSchema, tourListQuerySchema, cancelTourSchema, weeklyOffConfigSchema } = require('../validators/attendance.validator');
const attendanceController = require('../controllers/attendance.controller');

// All routes require authentication
router.use(authenticate);

// Employee routes
router.post('/punch-in', validate(punchInSchema), attendanceController.punchIn);
router.post('/punch-out', validate(punchOutSchema), attendanceController.punchOut);
router.get('/today', attendanceController.getTodayStatus);
router.get('/monthly', validate(monthlyQuerySchema, 'query'), attendanceController.getMonthlyAttendance);
router.get('/history', attendanceController.getAttendanceHistory);

// Admin/HR/Manager routes
router.get('/employee/:employeeId', selfOrAdmin(), attendanceController.getEmployeeAttendance);
router.get('/team', requirePermission('attendance:read'), attendanceController.getTeamAttendance);
router.patch('/override/:id', requirePermission('attendance:update'), attendanceController.overrideAttendance);

// Admin: Full attendance management
router.get('/admin/live', requirePermission('attendance:read'), validate(adminLiveQuerySchema, 'query'), attendanceController.getLiveAttendance);
router.get('/admin/history-all', requirePermission('attendance:read'), validate(adminHistoryQuerySchema, 'query'), attendanceController.getAllAttendanceHistory);
router.get('/admin/monthly-all', requirePermission('attendance:read'), validate(adminMonthlyQuerySchema, 'query'), attendanceController.getAllMonthlyAttendance);
router.post('/admin/manual-entry', requirePermission('attendance:create'), validate(manualEntrySchema), attendanceController.manualEntry);
router.put('/admin/adjust', requirePermission('attendance:update'), validate(manualEntrySchema), attendanceController.manualEntry);
router.put('/admin/weekly-off-config', requirePermission('attendance:update'), validate(weeklyOffConfigSchema), attendanceController.updateWeeklyOffConfig);

// ── Tour management routes ──
// Admin/HR: Mark an employee on tour (creates tour + attendance records)
router.post('/admin/tours', requirePermission('attendance:create'), validate(markTourSchema), attendanceController.markTour);
// Admin/HR: Get all tours (paginated + filters)
router.get('/admin/tours', requirePermission('attendance:read'), validate(tourListQuerySchema, 'query'), attendanceController.getAllTours);
// Admin/HR: Get a single tour by ID (with attendance records)
router.get('/admin/tours/:id', requirePermission('attendance:read'), attendanceController.getTourById);
// Admin/HR: Cancel a tour (past days → absent, future days → deleted)
router.patch('/admin/tours/:id/cancel', requirePermission('attendance:update'), validate(cancelTourSchema), attendanceController.cancelTour);

// Employee: Check if currently on tour (mobile app punch screen)
router.get('/tour-status', attendanceController.getTourStatus);

module.exports = router;