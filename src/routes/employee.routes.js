const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { updateProfileSchema, employeeQuerySchema } = require('../validators/employee.validator');
const { salaryStructureSchema } = require('../validators/auth.validator');
const employeeController = require('../controllers/employee.controller');

// All routes require authentication
router.use(authenticate);

// Self routes
router.get('/profile', employeeController.getMyProfile);
router.patch('/profile', validate(updateProfileSchema), employeeController.updateMyProfile);

// Admin/HR routes
router.get('/', requirePermission('employees:read'), validate(employeeQuerySchema, 'query'), employeeController.getAllEmployees);
router.get('/next-code', requirePermission('employees:create'), employeeController.getNextCode);
router.get('/recently-added', requirePermission('employees:read'), employeeController.getRecentlyAdded);
router.get('/:id', selfOrAdmin(), employeeController.getEmployeeById);
router.patch('/:id', requirePermission('employees:update'), employeeController.updateEmployee);
router.delete('/:id', requirePermission('employees:delete'), employeeController.deleteEmployee);
router.patch('/:id/status', requirePermission('employees:update'), employeeController.updateEmployeeStatus);
router.patch('/:id/role', requirePermission('role_mgmt:update'), employeeController.updateEmployeeRole);
router.post('/:id/rehire', requirePermission('employees:create'), employeeController.rehire);

// ── Admin Password Reset ──
router.put('/:id/admin-reset-password', requirePermission('employees:update'), employeeController.adminResetPassword);

// ── Salary Structure routes ──
router.get('/:id/salary', requirePermission('payroll:read'), employeeController.getEmployeeSalary);
router.put('/:id/salary', requirePermission('payroll:update'), validate(salaryStructureSchema), employeeController.updateEmployeeSalary);

module.exports = router;