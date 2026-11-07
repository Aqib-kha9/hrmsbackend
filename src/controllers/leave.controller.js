const leaveService = require('../services/leave.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class LeaveController {
  async getLeaveBalance(req, res, next) {
    try {
      const employeeId = req.params.employeeId || req.employee.id;
      const result = await leaveService.getLeaveBalance(employeeId);
      return success(res, 'Leave balance fetched', result, 200);
    } catch (err) {
      logger.error(`Get leave balance error: ${err.message}`);
      return next(err);
    }
  }

  async applyLeave(req, res, next) {
    try {
      // Admin/HR can apply on behalf of another employee via optional employee_id in body
      let employeeId = req.employee.id;
      const requesterRole = req.employee.role; // 'admin', 'hr', 'manager', 'employee'
      let isAdminOnBehalf = false;

      if (req.body.employee_id && req.body.employee_id !== req.employee.id) {
        // Only admin or hr can apply on behalf of others
        if (requesterRole !== 'admin' && requesterRole !== 'hr') {
          const err = new Error('Only admin or HR can apply leave on behalf of another employee');
          err.statusCode = 403;
          throw err;
        }
        employeeId = req.body.employee_id;
        isAdminOnBehalf = true; // bypass 1-per-month restriction for admin/HR
      }

      const leaveData = req.body;
      const result = await leaveService.applyLeave(employeeId, leaveData, isAdminOnBehalf);
      return success(res, 'Leave applied successfully', result, 201);
    } catch (err) {
      logger.error(`Apply leave error: ${err.message}`);
      return next(err);
    }
  }

  async getMyLeaveRequests(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { page, limit, status, search, from, to } = req.query;
      const result = await leaveService.getLeaveRequests(employeeId, { page, limit, status, search, from, to });
      return paginated(res, 'Leave requests fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get my leave requests error: ${err.message}`);
      return next(err);
    }
  }

  async cancelLeaveRequest(req, res, next) {
    try {
      const { id } = req.params;
      const employeeId = req.employee.id;
      const result = await leaveService.cancelLeaveRequest(id, employeeId);
      return success(res, 'Leave request cancelled', result, 200);
    } catch (err) {
      logger.error(`Cancel leave request error: ${err.message}`);
      return next(err);
    }
  }

  async getAllLeaveRequests(req, res, next) {
    try {
      const { page, limit, status, department, search, from, to } = req.query;
      const result = await leaveService.getAllLeaveRequests({ page, limit, status, department, search, from, to });
      return paginated(res, 'All leave requests fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get all leave requests error: ${err.message}`);
      return next(err);
    }
  }

  async approveLeaveRequest(req, res, next) {
    try {
      const { id } = req.params;
      const { action, remarks, payroll_treatment } = req.body;
      const approvedBy = req.employee.id;
      const result = await leaveService.approveLeaveRequest(id, action, remarks, approvedBy, payroll_treatment);
      return success(res, `Leave request ${action} successfully`, result, 200);
    } catch (err) {
      logger.error(`Approve leave request error: ${err.message}`);
      return next(err);
    }
  }

  async updateLeavePayrollTreatment(req, res, next) {
    try {
      const { id } = req.params;
      const { payroll_treatment, remarks, is_paid } = req.body;
      const updatedBy = req.employee.id;
      const result = await leaveService.updateLeavePayrollTreatment(id, {
        payroll_treatment,
        remarks,
        is_paid,
        updatedBy,
      });
      return success(res, 'Leave payroll treatment updated successfully', result, 200);
    } catch (err) {
      logger.error(`Update leave payroll treatment error: ${err.message}`);
      return next(err);
    }
  }

  async getEmployeeLeaveHistory(req, res, next) {
    try {
      const { employeeId } = req.params;
      const result = await leaveService.getEmployeeLeaveHistory(employeeId);
      return success(res, 'Employee leave history fetched successfully', result, 200);
    } catch (err) {
      logger.error(`Get employee leave history error: ${err.message}`);
      return next(err);
    }
  }

  async getTeamLeaves(req, res, next) {
    try {
      const managerId = req.employee.id;
      const { month, year } = req.query;
      const result = await leaveService.getTeamLeaves(managerId, month, year);
      return success(res, 'Team leaves fetched', result, 200);
    } catch (err) {
      logger.error(`Get team leaves error: ${err.message}`);
      return next(err);
    }
  }

  async getDepartments(req, res, next) {
    try {
      const departments = await leaveService.getDepartments();
      return success(res, 'Departments fetched', departments, 200);
    } catch (err) {
      logger.error(`Get departments error: ${err.message}`);
      return next(err);
    }
  }

  async grantLeave(req, res, next) {
    try {
      const adminId = req.employee.id;
      const { employeeId, count, reason } = req.body;
      const result = await leaveService.grantExtraLeaves(adminId, employeeId, count, reason);
      return success(res, `${count} leave(s) granted to employee`, result, 200);
    } catch (err) {
      logger.error(`Grant leave error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new LeaveController();