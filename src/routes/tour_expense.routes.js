const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createClaimSchema, rejectClaimSchema } = require('../validators/tour_expense.validator');
const tourExpenseController = require('../controllers/tour_expense.controller');

// All routes are protected
router.use(authenticate);

// Claims routes
router.get('/', tourExpenseController.getAllClaims);
router.get('/policy', tourExpenseController.getPolicies);
router.put('/policy', requirePermission('tour_expenses:update'), tourExpenseController.updatePolicies);
router.post('/', validate(createClaimSchema), tourExpenseController.createClaim);
router.get('/:id', tourExpenseController.getClaimById);
router.post('/:id/approve', requirePermission('tour_expenses:approve'), tourExpenseController.approveClaim);
router.post('/:id/reject', requirePermission('tour_expenses:approve'), validate(rejectClaimSchema), tourExpenseController.rejectClaim);

module.exports = router;
