const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { applyLoanSchema, loanQuerySchema } = require('../validators/loan.validator');
const loanController = require('../controllers/loan.controller');

// All routes require authentication
router.use(authenticate);

// Employee routes
router.get('/my', loanController.getMyLoans);
router.get('/my/:id', loanController.getLoanById);
router.get('/my/:id/payments', loanController.getLoanPayments);
router.post('/apply', validate(applyLoanSchema), loanController.applyLoan);

// Admin/HR routes (Fine-grained permission gates)
router.get('/', requirePermission('loans:read'), validate(loanQuerySchema, 'query'), loanController.getAllLoans);
router.get('/employee/:employeeId', selfOrAdmin(), loanController.getEmployeeLoans);
router.get('/:id', requirePermission('loans:read'), loanController.getLoanByIdAdmin);
router.patch('/:id/approve', requirePermission('loans:approve'), loanController.approveLoan);
router.patch('/:id/reject', requirePermission('loans:approve'), loanController.rejectLoan);
router.post('/:id/payment', requirePermission('loans:update'), loanController.recordLoanPayment);

module.exports = router;