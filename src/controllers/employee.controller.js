const employeeService = require('../services/employee.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class EmployeeController {
  async getMyProfile(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const result = await employeeService.getEmployeeById(employeeId);
      return success(res, 'Profile fetched', result, 200);
    } catch (err) {
      logger.error(`Get my profile error: ${err.message}`);
      return next(err);
    }
  }

  async updateMyProfile(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const updateData = req.body;
      const result = await employeeService.updateEmployee(employeeId, updateData);
      return success(res, 'Profile updated', result, 200);
    } catch (err) {
      logger.error(`Update my profile error: ${err.message}`);
      return next(err);
    }
  }

  async getAllEmployees(req, res, next) {
    try {
      const { page, limit, department, role, status, search, company_id, office_id } = req.query;
      const result = await employeeService.getAllEmployees({ page, limit, department, role, status, search, company_id, office_id });
      return paginated(res, 'Employees fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get all employees error: ${err.message}`);
      return next(err);
    }
  }

  async getEmployeeById(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.getEmployeeById(id);
      return success(res, 'Employee fetched', result, 200);
    } catch (err) {
      logger.error(`Get employee by id error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployee(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const result = await employeeService.updateEmployee(id, updateData);
      return success(res, 'Employee updated', result, 200);
    } catch (err) {
      logger.error(`Update employee error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const result = await employeeService.updateEmployeeStatus(id, status);
      return success(res, 'Employee status updated', result, 200);
    } catch (err) {
      logger.error(`Update employee status error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeRole(req, res, next) {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const result = await employeeService.updateEmployeeRole(id, role);
      return success(res, 'Employee role updated', result, 200);
    } catch (err) {
      logger.error(`Update employee role error: ${err.message}`);
      return next(err);
    }
  }

  // ── Salary Structure ─────────────────────────────────────────────

  async getEmployeeSalary(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.getSalaryStructures(id);
      return success(res, 'Salary structure fetched', result, 200);
    } catch (err) {
      logger.error(`Get employee salary error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeSalary(req, res, next) {
    try {
      const { id } = req.params;
      const salaryData = req.body;
      const updatedBy = req.employee.id;
      const result = await employeeService.updateSalaryStructure(id, salaryData, updatedBy);
      return success(res, 'Salary structure updated', result, 201);
    } catch (err) {
      logger.error(`Update employee salary error: ${err.message}`);
      return next(err);
    }
  }

  async deleteEmployee(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.deleteEmployee(id);
      return success(res, `Employee ${result.emp_code} deleted permanently`, result, 200);
    } catch (err) {
      logger.error(`Delete employee error: ${err.message}`);
      return next(err);
    }
  }

  // ── Admin Password Reset ──────────────────────────────────────────

  /**
   * Admin resets an employee's password directly.
   * Returns the new plain-text password so the admin can communicate it to
   * the employee through a side channel (in person / Slack / WhatsApp).
   */
  async adminResetPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { customPassword } = req.body;
      const adminId = req.employee.id;
      const result = await employeeService.adminResetPassword(id, adminId, customPassword);
      return success(res, 'Password reset successfully', result, 200);
    } catch (err) {
      logger.error(`Admin reset password error: ${err.message}`);
      return next(err);
    }
  }

  // ── Company-Specific Sequential Employee ID (Req 2.2) ──
  async getNextCode(req, res, next) {
    try {
      const target = req.query.company_id || req.query.companyId || req.query.prefix || null;
      const result = await employeeService.getNextEmployeeCodeDetails(target);
      return success(res, 'Next company-specific sequential employee code generated', result, 200);
    } catch (err) {
      logger.error(`Get next employee code error: ${err.message}`);
      return next(err);
    }
  }

  // ── Recently Added Employees (Req 1.1) ──
  async getRecentlyAdded(req, res, next) {
    try {
      const limit = req.query.limit || 6;
      const employees = await employeeService.getRecentlyAddedEmployees(limit);
      return success(res, 'Recently added employees retrieved successfully', employees, 200);
    } catch (err) {
      logger.error(`Get recently added employees error: ${err.message}`);
      return next(err);
    }
  }

  // ── Resigned Employee Re-Hiring (Req 23) ──
  async rehire(req, res, next) {
    try {
      const { id } = req.params;
      const rehireData = req.body;
      const approvedBy = req.employee.id;
      const result = await employeeService.rehireEmployee(id, rehireData, approvedBy);
      return success(res, `Employee ${result.emp_code} re-hired successfully`, result, 200);
    } catch (err) {
      logger.error(`Rehire employee error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new EmployeeController();