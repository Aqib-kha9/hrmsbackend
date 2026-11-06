const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');

// All authenticated users can view companies
router.get('/', authenticate, companyController.getCompanies);
router.get('/:id', authenticate, companyController.getCompanyById);

// Admin & HR can create/update/delete companies
router.post('/', authenticate, requirePermission('settings:create'), companyController.createCompany);
router.put('/:id', authenticate, requirePermission('settings:update'), companyController.updateCompany);
router.delete('/:id', authenticate, requirePermission('settings:delete'), companyController.deleteCompany);

module.exports = router;