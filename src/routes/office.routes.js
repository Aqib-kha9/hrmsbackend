const router = require('express').Router();
const officeController = require('../controllers/office.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createOfficeSchema, updateOfficeSchema, officeQuerySchema } = require('../validators/office.validator');

// All routes require authentication
router.use(authenticate);

// ── Read endpoints (any authenticated user can access) ──
router.get('/stats', officeController.getOfficeStats);
router.get('/', validate(officeQuerySchema, 'query'), officeController.getOffices);
router.get('/:id', officeController.getOfficeById);

// ── Management endpoints (admin & hr only) ──
router.post('/', requirePermission('locations:create'), validate(createOfficeSchema), officeController.createOffice);
router.put('/:id', requirePermission('locations:update'), validate(updateOfficeSchema), officeController.updateOffice);
router.delete('/:id', requirePermission('locations:delete'), officeController.deleteOffice);

module.exports = router;