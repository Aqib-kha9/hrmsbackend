const { error } = require('../utils/response');

/**
 * Normalizes role name to standard uppercase (e.g. 'super_admin' -> 'SUPER_ADMIN')
 */
const normalizeRole = (role) => (role || '').trim().toUpperCase().replace(/\s+/g, '_');

/**
 * Checks if the user is a super administrator with unrestricted access
 */
const isSuperAdmin = (employee) => {
  if (!employee) return false;
  const roleName = normalizeRole(employee.role);
  const detailRoleName = employee.roleDetails ? normalizeRole(employee.roleDetails.name) : '';
  return (
    roleName === 'SUPER_ADMIN' ||
    roleName === 'ADMIN' ||
    detailRoleName === 'SUPER_ADMIN' ||
    detailRoleName === 'ADMIN' ||
    employee.id === 1 ||
    Boolean(employee.is_superuser)
  );
};

/**
 * Fine-grained Permission Middleware
 * Verifies if the authenticated employee has the required permission slug.
 * Super Admins and Admins automatically bypass permission checks.
 *
 * @param {string} requiredPermission - Permission slug e.g. 'employees:read', 'payroll:export'
 */
const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.employee) {
      return error(res, 'Authentication required', 401);
    }

    // Super Admin / Admin bypass
    if (isSuperAdmin(req.employee)) {
      return next();
    }

    const userPermissions = req.employee.permissions || [];

    // Wildcard bypass
    if (userPermissions.includes('*')) {
      return next();
    }

    // Module-level wildcard check (e.g. 'employees:*')
    const [moduleName] = requiredPermission.split(':');
    if (userPermissions.includes(`${moduleName}:*`)) {
      return next();
    }

    // Exact slug match
    if (userPermissions.includes(requiredPermission)) {
      return next();
    }

    return error(
      res,
      `Access denied. You lack the required permission: [${requiredPermission}]`,
      403
    );
  };
};

/**
 * Require at least ONE of the provided permission slugs
 *
 * @param {...string} permissions - Permission slugs
 */
const requireAnyPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.employee) {
      return error(res, 'Authentication required', 401);
    }

    if (isSuperAdmin(req.employee)) {
      return next();
    }

    const userPermissions = req.employee.permissions || [];
    if (userPermissions.includes('*')) {
      return next();
    }

    const hasAny = permissions.some((slug) => {
      const [moduleName] = slug.split(':');
      return userPermissions.includes(slug) || userPermissions.includes(`${moduleName}:*`);
    });

    if (hasAny) {
      return next();
    }

    return error(
      res,
      `Access denied. Required at least one permission: [${permissions.join(', ')}]`,
      403
    );
  };
};

/**
 * Require ALL of the provided permission slugs
 *
 * @param {...string} permissions - Permission slugs
 */
const requireAllPermissions = (...permissions) => {
  return (req, res, next) => {
    if (!req.employee) {
      return error(res, 'Authentication required', 401);
    }

    if (isSuperAdmin(req.employee)) {
      return next();
    }

    const userPermissions = req.employee.permissions || [];
    if (userPermissions.includes('*')) {
      return next();
    }

    const hasAll = permissions.every((slug) => {
      const [moduleName] = slug.split(':');
      return userPermissions.includes(slug) || userPermissions.includes(`${moduleName}:*`);
    });

    if (hasAll) {
      return next();
    }

    return error(
      res,
      `Access denied. All permissions required: [${permissions.join(', ')}]`,
      403
    );
  };
};

/**
 * Role-based access control middleware (flexible uppercase & lowercase matching)
 *
 * @param {...string} allowedRoles - Allowed role names e.g. 'ADMIN', 'HR', 'manager'
 */
const requireRole = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map(normalizeRole);
  return (req, res, next) => {
    if (!req.employee) {
      return error(res, 'Authentication required', 401);
    }

    // SUPER_ADMIN and ADMIN always have unrestricted access
    if (isSuperAdmin(req.employee)) {
      return next();
    }

    const userRole = normalizeRole(req.employee.role);
    const detailRole = req.employee.roleDetails ? normalizeRole(req.employee.roleDetails.name) : '';

    if (
      normalizedAllowed.includes(userRole) ||
      (detailRole && normalizedAllowed.includes(detailRole))
    ) {
      return next();
    }

    return error(
      res,
      `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      403
    );
  };
};

/**
 * Self-or-Permission middleware
 * Grants access if the target resource belongs to the current user (isSelf),
 * OR if the user has the required administrative permission.
 *
 * @param {string} permissionSlug - Required permission if not self (e.g. 'employees:read')
 * @param {string} [paramName='id'] - Name of route parameter matching employee ID
 */
const selfOrPermission = (permissionSlug, paramName = 'id') => {
  return (req, res, next) => {
    if (!req.employee) {
      return error(res, 'Authentication required', 401);
    }

    const rawTarget = req.params[paramName] || req.params.employee_id || req.params.employeeId;
    const targetId = parseInt(rawTarget, 10);
    const isSelf = targetId && req.employee.id === targetId;

    if (isSelf) {
      return next();
    }

    // If not self, verify permission or super admin
    if (isSuperAdmin(req.employee)) {
      return next();
    }

    const userPermissions = req.employee.permissions || [];
    const [moduleName] = permissionSlug.split(':');
    if (
      userPermissions.includes('*') ||
      userPermissions.includes(`${moduleName}:*`) ||
      userPermissions.includes(permissionSlug)
    ) {
      return next();
    }

    return error(
      res,
      `Access denied. You can only view your own records or require [${permissionSlug}] permission.`,
      403
    );
  };
};

module.exports = {
  normalizeRole,
  isSuperAdmin,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole,
  selfOrPermission,
  // Backward compatibility alias for legacy routes using authorize(...)
  authorize: requireRole,
  selfOrAdmin: (paramName = 'id') => selfOrPermission('employees:read', paramName),
};
