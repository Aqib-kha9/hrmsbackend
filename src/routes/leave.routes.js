const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  applyLeaveSchema,
  approveLeaveSchema,
  leaveQuerySchema,
  grantLeaveSchema,
  leaveHistoryQuerySchema,
  leaveSummaryQuerySchema,
  leavePolicySchema,
  rolloverSchema,
} = require('../validators/leave.validator');
const leaveController = require('../controllers/leave.controller');

// All routes require authentication
router.use(authenticate);

// Leave Policy Configuration & Summary routes (Req 2.6)
router.get('/policy', requirePermission('leave:read'), leaveController.getLeavePolicy);
router.put('/policy', requirePermission('leave:approve'), validate(leavePolicySchema), leaveController.updateLeavePolicy);
router.post('/policy/rollover', requirePermission('leave:approve'), validate(rolloverSchema), leaveController.applyYearEndRollover);
router.get('/employees-summary', requirePermission('leave:read'), validate(leaveSummaryQuerySchema, 'query'), leaveController.getAllEmployeesLeaveSummary);

// Employee routes
router.get('/balance', leaveController.getLeaveBalance);
router.get('/balance/:employeeId', selfOrAdmin(), leaveController.getLeaveBalance);
router.post('/apply', validate(applyLeaveSchema), leaveController.applyLeave);
router.get('/my-requests', leaveController.getMyLeaveRequests);
router.patch('/cancel/:id', leaveController.cancelLeaveRequest);

// Admin/HR/Manager routes (gated by dynamic permissions)
router.get('/requests', requirePermission('leave:read'), validate(leaveQuerySchema, 'query'), leaveController.getAllLeaveRequests);
router.get('/history/:employeeId', requirePermission('leave:read'), validate(leaveHistoryQuerySchema, 'query'), leaveController.getEmployeeLeaveHistory);
router.patch('/approve/:id', requirePermission('leave:approve'), validate(approveLeaveSchema), leaveController.approveLeaveRequest);
router.patch('/:id/payroll-treatment', requirePermission('leave:approve'), leaveController.updateLeavePayrollTreatment);
router.get('/team', requirePermission('leave:read'), leaveController.getTeamLeaves);

// Admin-only: grant extra leaves
router.post('/grant', requirePermission('leave:create'), validate(grantLeaveSchema), leaveController.grantLeave);

// Departments list (for filters)
router.get('/departments', leaveController.getDepartments);

module.exports = router;