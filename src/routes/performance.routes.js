const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { objectiveSchema, updateObjectiveSchema, reviewSchema } = require('../validators/performance.validator');
const performanceController = require('../controllers/performance.controller');

// All routes require authentication
router.use(authenticate);

// Objectives
router.get('/objectives', performanceController.getMyObjectives);
router.post('/objectives', validate(objectiveSchema), performanceController.createObjective);
router.patch('/objectives/:id', validate(updateObjectiveSchema), performanceController.updateObjective);
router.delete('/objectives/:id', performanceController.deleteObjective);

// Reviews
router.get('/reviews', performanceController.getMyReviews);
router.get('/reviews/:id', performanceController.getReviewById);

// Admin/HR/Manager routes
router.get('/employee/:employeeId/objectives', selfOrAdmin(), performanceController.getEmployeeObjectives);
router.get('/employee/:employeeId/reviews', selfOrAdmin(), performanceController.getEmployeeReviews);
router.post('/employee/:employeeId/reviews', requirePermission('performance:create'), validate(reviewSchema), performanceController.createReview);
router.patch('/reviews/:id', requirePermission('performance:update'), performanceController.updateReview);

module.exports = router;