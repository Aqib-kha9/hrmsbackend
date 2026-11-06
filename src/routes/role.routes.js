const express = require('express');
const router = express.Router();
const roleController = require('../controllers/role.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

// All role management endpoints require authentication
router.use(authenticate);

// 1. Permission Matrix Schema (public to authenticated users for UI rendering)
router.get('/permissions/matrix', roleController.getPermissionMatrix);

// 2. Assign role to employee
router.post('/assign', requirePermission('role_mgmt:update'), roleController.assignRoleToEmployee);

// 3. Update permissions matrix specifically
router.put('/:id/permissions', requirePermission('role_mgmt:update'), roleController.updateRolePermissions);

// 4. Role CRUD
router.get('/', requirePermission('role_mgmt:read'), roleController.getAllRoles);
router.get('/:id', requirePermission('role_mgmt:read'), roleController.getRoleById);
router.post('/', requirePermission('role_mgmt:create'), roleController.createRole);
router.put('/:id', requirePermission('role_mgmt:update'), roleController.updateRole);
router.delete('/:id', requirePermission('role_mgmt:delete'), roleController.deleteRole);

module.exports = router;
