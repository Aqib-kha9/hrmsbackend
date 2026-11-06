const { Role, Permission, RolePermission, Employee, sequelize } = require('../models');
const { AppError } = require('../utils/response');
const logger = require('../utils/logger');

class RoleService {
  /**
   * Helper: converts list of Permission instances into a Frontend Matrix
   * { MODULE_NAME: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'] }
   */
  _buildMatrix(permissions = []) {
    const matrix = {};
    for (const p of permissions) {
      const mod = p.module.toUpperCase();
      if (!matrix[mod]) {
        matrix[mod] = [];
      }
      if (!matrix[mod].includes(p.action)) {
        matrix[mod].push(p.action);
      }
    }
    return matrix;
  }

  _getFullSuperAdminMatrix() {
    return {
      DASHBOARD: ['READ'],
      EMPLOYEES: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT'],
      ONBOARDING: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
      ATTENDANCE: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'],
      LOCATIONS: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
      LEAVE: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'],
      PAYROLL: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'],
      LOANS: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'],
      PERFORMANCE: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE'],
      LETTERS: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
      TOUR_EXPENSES: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT'],
      REPORTS: ['READ', 'EXPORT'],
      SETTINGS: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
      ROLE_MGMT: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
    };
  }

  /**
   * Get all roles with permission count, employee count, and matrix
   */
  async getAllRoles() {
    const roles = await Role.findAll({
      order: [['is_system', 'DESC'], ['id', 'ASC']],
      include: [
        {
          model: Permission,
          as: 'permissions',
          attributes: ['id', 'module', 'action', 'slug', 'description'],
          through: { attributes: [] },
        },
      ],
    });

    // Fetch employee counts per role
    const employeeCounts = await Employee.findAll({
      attributes: ['role_id', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['role_id'],
      raw: true,
    });
    const countMap = {};
    employeeCounts.forEach((r) => {
      if (r.role_id) countMap[r.role_id] = parseInt(r.count, 10);
    });

    return roles.map((role) => {
      const plain = role.get({ plain: true });
      const isSuper = plain.name === 'SUPER_ADMIN';
      const matrix = isSuper ? this._getFullSuperAdminMatrix() : this._buildMatrix(plain.permissions || []);
      return {
        id: plain.id,
        name: plain.name,
        display_name: plain.display_name,
        description: plain.description,
        is_system: plain.is_system,
        status: plain.status,
        created_at: plain.created_at,
        updated_at: plain.updated_at,
        employee_count: countMap[plain.id] || 0,
        permission_count: isSuper ? Object.keys(matrix).length * 6 : (plain.permissions?.length || 0),
        permissions: plain.permissions || [],
        matrix,
      };
    });
  }

  /**
   * Get single role details by ID
   */
  async getRoleById(roleId) {
    const role = await Role.findByPk(roleId, {
      include: [
        {
          model: Permission,
          as: 'permissions',
          attributes: ['id', 'module', 'action', 'slug', 'description'],
          through: { attributes: [] },
        },
        {
          model: Employee,
          as: 'employees',
          attributes: ['id', 'emp_code', 'name', 'email', 'designation', 'department'],
        },
      ],
    });

    if (!role) {
      throw new AppError('Role not found', 404);
    }

    const plain = role.get({ plain: true });
    const isSuper = plain.name === 'SUPER_ADMIN';
    const matrix = isSuper ? this._getFullSuperAdminMatrix() : this._buildMatrix(plain.permissions || []);
    return {
      id: plain.id,
      name: plain.name,
      display_name: plain.display_name,
      description: plain.description,
      is_system: plain.is_system,
      status: plain.status,
      created_at: plain.created_at,
      updated_at: plain.updated_at,
      employee_count: plain.employees?.length || 0,
      employees: plain.employees || [],
      permission_count: isSuper ? Object.keys(matrix).length * 6 : (plain.permissions?.length || 0),
      permissions: plain.permissions || [],
      matrix,
    };
  }

  /**
   * Create a new role with permissions
   */
  async createRole(payload) {
    const rawName = (payload.name || '').trim();
    if (!rawName) {
      throw new AppError('Role name is required', 400);
    }

    const roleName = rawName.toUpperCase().replace(/\s+/g, '_');
    const existingRole = await Role.findOne({ where: { name: roleName } });
    if (existingRole) {
      throw new AppError(`Role with name [${roleName}] already exists`, 409);
    }

    const displayName = payload.display_name || rawName.replace(/_/g, ' ');

    return await sequelize.transaction(async (t) => {
      const newRole = await Role.create({
        name: roleName,
        display_name: displayName,
        description: payload.description || `Custom role for ${displayName}`,
        is_system: false,
        status: payload.status || 'active',
      }, { transaction: t });

      // Determine permission IDs to associate
      const permissionIds = await this._resolvePermissionIds(payload, t);
      if (permissionIds.length > 0) {
        const rows = permissionIds.map((pId) => ({
          role_id: newRole.id,
          permission_id: pId,
        }));
        await RolePermission.bulkCreate(rows, { transaction: t });
      }

      logger.info(`Created new custom role: ${roleName} (ID: ${newRole.id}) with ${permissionIds.length} permissions`);
      return this.getRoleById(newRole.id);
    });
  }

  /**
   * Update role details and/or permissions
   */
  async updateRole(roleId, payload) {
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw new AppError('Role not found', 404);
    }

    if (role.name === 'SUPER_ADMIN') {
      throw new AppError('Super Administrator permissions and settings are immutable and cannot be modified.', 400);
    }

    return await sequelize.transaction(async (t) => {
      // Do not allow renaming system roles
      const updateData = {};
      if (payload.display_name) updateData.display_name = payload.display_name;
      if (payload.description !== undefined) updateData.description = payload.description;
      if (payload.status) updateData.status = payload.status;

      if (!role.is_system && payload.name) {
        const formattedName = payload.name.toUpperCase().replace(/\s+/g, '_');
        if (formattedName !== role.name) {
          const duplicate = await Role.findOne({ where: { name: formattedName } });
          if (duplicate && duplicate.id !== role.id) {
            throw new AppError(`Role name [${formattedName}] already exists`, 409);
          }
          updateData.name = formattedName;
        }
      }

      await role.update(updateData, { transaction: t });

      // Update permissions if provided
      if (payload.matrix !== undefined || payload.permissions !== undefined || payload.permission_ids !== undefined) {
        const targetIds = await this._resolvePermissionIds(payload, t);

        // Delete existing mappings
        await RolePermission.destroy({
          where: { role_id: role.id },
          transaction: t,
        });

        // Insert new mappings
        if (targetIds.length > 0) {
          const rows = targetIds.map((pId) => ({
            role_id: role.id,
            permission_id: pId,
          }));
          await RolePermission.bulkCreate(rows, { transaction: t });
        }
      }

      logger.info(`Updated role ${role.name} (ID: ${role.id})`);
      return this.getRoleById(role.id);
    });
  }

  /**
   * Update only the permission matrix for a role
   */
  async updateRolePermissions(roleId, matrixOrSlugs) {
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw new AppError('Role not found', 404);
    }

    if (role.name === 'SUPER_ADMIN') {
      throw new AppError('Super Administrator permissions are immutable and cannot be modified.', 400);
    }

    return await sequelize.transaction(async (t) => {
      const payload = typeof matrixOrSlugs === 'object' && !Array.isArray(matrixOrSlugs)
        ? { matrix: matrixOrSlugs }
        : { permissions: matrixOrSlugs };

      const targetIds = await this._resolvePermissionIds(payload, t);

      // Wipe old permissions
      await RolePermission.destroy({
        where: { role_id: role.id },
        transaction: t,
      });

      // Insert new permissions
      if (targetIds.length > 0) {
        const rows = targetIds.map((pId) => ({
          role_id: role.id,
          permission_id: pId,
        }));
        await RolePermission.bulkCreate(rows, { transaction: t });
      }

      logger.info(`Updated permissions matrix for role: ${role.name} (${targetIds.length} permissions)`);
      return this.getRoleById(role.id);
    });
  }

  /**
   * Delete a custom role
   */
  async deleteRole(roleId) {
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw new AppError('Role not found', 404);
    }

    if (role.is_system) {
      throw new AppError(`System role [${role.name}] cannot be deleted`, 400);
    }

    // Check if employees are assigned to this role
    const assignedCount = await Employee.count({ where: { role_id: role.id } });
    if (assignedCount > 0) {
      throw new AppError(
        `Cannot delete role [${role.name}]. It is currently assigned to ${assignedCount} employee(s). Please reassign them first.`,
        400
      );
    }

    await RolePermission.destroy({ where: { role_id: role.id } });
    await role.destroy();

    logger.info(`Deleted custom role: ${role.name} (ID: ${roleId})`);
    return { success: true, message: `Role ${role.name} deleted successfully` };
  }

  /**
   * Returns complete schema of available modules and actions
   */
  async getPermissionMatrix() {
    const allPermissions = await Permission.findAll({
      order: [['module', 'ASC'], ['action', 'ASC']],
    });

    const grouped = {};
    allPermissions.forEach((p) => {
      const mod = p.module.toUpperCase();
      if (!grouped[mod]) {
        grouped[mod] = [];
      }
      grouped[mod].push({
        id: p.id,
        action: p.action,
        slug: p.slug,
        description: p.description,
      });
    });

    return grouped;
  }

  /**
   * Assign a role to an employee
   */
  async assignRoleToEmployee(employeeId, roleIdentifier) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    let role;
    if (typeof roleIdentifier === 'number' || !isNaN(Number(roleIdentifier))) {
      role = await Role.findByPk(roleIdentifier);
    } else {
      const normalized = (roleIdentifier || '').toUpperCase().replace(/\s+/g, '_');
      role = await Role.findOne({ where: { name: normalized } });
    }

    if (!role) {
      throw new AppError(`Role [${roleIdentifier}] not found`, 404);
    }

    await employee.update({
      role_id: role.id,
      role: role.name.toLowerCase(), // keep legacy string column in sync
    });

    logger.info(`Assigned role [${role.name}] to employee ${employee.emp_code} (${employee.name})`);
    return {
      employee_id: employee.id,
      emp_code: employee.emp_code,
      name: employee.name,
      role: role.name,
      role_id: role.id,
    };
  }

  /**
   * Helper to resolve permission IDs from matrix, slug list, or ID list
   */
  async _resolvePermissionIds(payload, transaction) {
    // 1. Direct IDs
    if (Array.isArray(payload.permission_ids) && payload.permission_ids.length > 0) {
      return payload.permission_ids;
    }

    // 2. Slugs array
    if (Array.isArray(payload.permissions) && payload.permissions.length > 0) {
      const perms = await Permission.findAll({
        where: { slug: payload.permissions },
        attributes: ['id'],
        transaction,
      });
      return perms.map((p) => p.id);
    }

    // 3. Matrix format: { EMPLOYEES: ['CREATE', 'READ'], ... }
    if (payload.matrix && typeof payload.matrix === 'object') {
      const targetSlugs = [];
      for (const [moduleName, actions] of Object.entries(payload.matrix)) {
        if (!Array.isArray(actions)) continue;
        actions.forEach((act) => {
          targetSlugs.push(`${moduleName.toLowerCase()}:${act.toLowerCase()}`);
        });
      }

      if (targetSlugs.length === 0) return [];

      const perms = await Permission.findAll({
        where: { slug: targetSlugs },
        attributes: ['id'],
        transaction,
      });
      return perms.map((p) => p.id);
    }

    return [];
  }
}

module.exports = new RoleService();
