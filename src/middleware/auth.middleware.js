const { verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const { Employee, Role, Permission } = require('../models');

/**
 * Authentication middleware — verifies JWT access token
 * Attaches decoded user to req.employee along with fine-grained permissions
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Access token is required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return error(res, 'Invalid or expired access token', 401);
    }

    // Verify employee still exists and is active, with their RBAC role and permissions
    const employee = await Employee.findByPk(decoded.id, {
      attributes: ['id', 'emp_code', 'name', 'email', 'role', 'role_id', 'status', 'department', 'designation', 'office_id'],
      include: [
        {
          model: Role,
          as: 'roleDetails',
          include: [
            {
              model: Permission,
              as: 'permissions',
              attributes: ['slug', 'module', 'action'],
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    if (!employee) {
      return error(res, 'Employee not found', 401);
    }

    if (employee.status !== 'active') {
      return error(res, 'Account is inactive or suspended', 401);
    }

    // Extract permission slugs
    let permissions = [];
    if (employee.roleDetails && employee.roleDetails.permissions) {
      permissions = employee.roleDetails.permissions.map((p) => p.slug);
    }

    const roleNormalized = (employee.role || '').toUpperCase();
    const roleDetailsNormalized = (employee.roleDetails?.name || '').toUpperCase();
    const isSuper = (
      roleNormalized === 'SUPER_ADMIN' ||
      roleNormalized === 'ADMIN' ||
      roleDetailsNormalized === 'SUPER_ADMIN' ||
      roleDetailsNormalized === 'ADMIN' ||
      employee.id === 1
    );

    if (isSuper) {
      if (!permissions.includes('*')) {
        permissions.unshift('*');
      }
    } else if (permissions.length === 0 && employee.role) {
      // Fallback: If role_id was not populated, resolve permissions by legacy role string
      try {
        const fallbackRole = await Role.findOne({
          where: { name: roleNormalized },
          include: [
            {
              model: Permission,
              as: 'permissions',
              attributes: ['slug'],
              through: { attributes: [] },
            },
          ],
        });
        if (fallbackRole && fallbackRole.permissions) {
          permissions = fallbackRole.permissions.map((p) => p.slug);
          if (!employee.role_id) {
            employee.update({ role_id: fallbackRole.id }).catch(() => {});
          }
        }
      } catch (_) {}
    }

    req.employee = employee;
    req.employee.permissions = permissions;
    next();
  } catch (err) {
    return error(res, 'Authentication failed', 401);
  }
};

/**
 * Optional authentication — attaches user if token present, but doesn't block
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded) {
        const employee = await Employee.findByPk(decoded.id, {
          attributes: ['id', 'emp_code', 'name', 'email', 'role', 'status', 'department', 'designation', 'office_id'],
        });
        if (employee && employee.status === 'active') {
          req.employee = employee;
        }
      }
    }
    next();
  } catch (err) {
    next();
  }
};

/**
 * Refresh token middleware — verifies refresh token from header or body
 */
const authenticateRefresh = async (req, res, next) => {
  try {
    const refreshToken = req.headers['x-refresh-token'] || req.body.refresh_token;
    if (!refreshToken) {
      return error(res, 'Refresh token is required', 401);
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    const employee = await Employee.findByPk(decoded.id);
    if (!employee || employee.refresh_token !== refreshToken) {
      return error(res, 'Refresh token does not match', 401);
    }

    req.employee = employee;
    next();
  } catch (err) {
    return error(res, 'Refresh authentication failed', 401);
  }
};

module.exports = { authenticate, optionalAuth, authenticateRefresh };