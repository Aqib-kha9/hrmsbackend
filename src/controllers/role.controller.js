const roleService = require('../services/role.service');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

class RoleController {
  async getAllRoles(req, res, next) {
    try {
      const roles = await roleService.getAllRoles();
      return success(res, 'Roles fetched successfully', roles, 200);
    } catch (err) {
      logger.error(`Get all roles error: ${err.message}`);
      return next(err);
    }
  }

  async getRoleById(req, res, next) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const role = await roleService.getRoleById(roleId);
      return success(res, 'Role details fetched successfully', role, 200);
    } catch (err) {
      logger.error(`Get role by id error: ${err.message}`);
      return next(err);
    }
  }

  async createRole(req, res, next) {
    try {
      const role = await roleService.createRole(req.body);
      return success(res, 'Role created successfully', role, 201);
    } catch (err) {
      logger.error(`Create role error: ${err.message}`);
      return next(err);
    }
  }

  async updateRole(req, res, next) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const role = await roleService.updateRole(roleId, req.body);
      return success(res, 'Role updated successfully', role, 200);
    } catch (err) {
      logger.error(`Update role error: ${err.message}`);
      return next(err);
    }
  }

  async updateRolePermissions(req, res, next) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const { matrix, permissions } = req.body;
      const role = await roleService.updateRolePermissions(roleId, matrix || permissions);
      return success(res, 'Role permissions updated successfully', role, 200);
    } catch (err) {
      logger.error(`Update role permissions error: ${err.message}`);
      return next(err);
    }
  }

  async deleteRole(req, res, next) {
    try {
      const roleId = parseInt(req.params.id, 10);
      const result = await roleService.deleteRole(roleId);
      return success(res, result.message, null, 200);
    } catch (err) {
      logger.error(`Delete role error: ${err.message}`);
      return next(err);
    }
  }

  async getPermissionMatrix(req, res, next) {
    try {
      const matrix = await roleService.getPermissionMatrix();
      return success(res, 'Permission matrix schema fetched successfully', matrix, 200);
    } catch (err) {
      logger.error(`Get permission matrix error: ${err.message}`);
      return next(err);
    }
  }

  async assignRoleToEmployee(req, res, next) {
    try {
      const { employee_id, role_id, role_name } = req.body;
      const targetRole = role_id || role_name;
      const result = await roleService.assignRoleToEmployee(employee_id, targetRole);
      return success(res, 'Role assigned to employee successfully', result, 200);
    } catch (err) {
      logger.error(`Assign role error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new RoleController();
