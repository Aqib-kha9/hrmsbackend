const { LeaveBalance, LeaveRequest, Employee, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');
const notificationService = require('./notification.service');

class LeaveService {
  /**
   * Helper: Ensure annual leave balance record exists for the employee.
   * Default Annual entitlement: 12 Casual Leave (CL) + 12 Earned Leave (EL) = 24 days/year (Req 9.1).
   */
  async _ensureAnnualBalance(employeeId) {
    const currentYear = new Date().getFullYear();
    let balance = await LeaveBalance.findOne({
      where: { employee_id: employeeId },
    });

    if (!balance) {
      balance = await LeaveBalance.create({
        employee_id: employeeId,
        year: currentYear,
        cl_allocated: 12.00,
        cl_used: 0.00,
        el_allocated: 12.00,
        el_carried_forward: 0.00,
        el_used: 0.00,
        available: 24,
        used: 0,
        admin_granted: 0,
        lapsed: 0,
      });
    } else if (balance.year !== currentYear) {
      // Annual reset cycle:
      // CL does NOT carry forward (resets to 12)
      // EL carries forward unused balance (subject to policy)
      const unusedEl = Math.max(0, Number(balance.el_allocated || 12) + Number(balance.el_carried_forward || 0) - Number(balance.el_used || 0));
      await balance.update({
        year: currentYear,
        cl_allocated: 12.00,
        cl_used: 0.00,
        el_allocated: 12.00,
        el_carried_forward: unusedEl,
        el_used: 0.00,
        available: Math.round(12 + 12 + unusedEl),
        used: 0,
      });
    }

    return balance;
  }

  /**
   * Get annual leave balance and entitlement for an employee (Req 9.1 & 9.2).
   */
  async getLeaveBalance(employeeId) {
    const balance = await this._ensureAnnualBalance(employeeId);

    const clAllocated = Number(balance.cl_allocated || 12);
    const clUsed = Number(balance.cl_used || 0);
    const clBalance = Math.max(0, clAllocated - clUsed);

    const elAllocated = Number(balance.el_allocated || 12);
    const elCarried = Number(balance.el_carried_forward || 0);
    const elUsed = Number(balance.el_used || 0);
    const elBalance = Math.max(0, (elAllocated + elCarried) - elUsed);

    // Pending leave requests count
    const pendingCount = await LeaveRequest.count({
      where: { employee_id: employeeId, status: 'pending' },
    });

    const totalEntitlement = clAllocated + elAllocated + elCarried;
    const totalRemaining = clBalance + elBalance;

    return {
      id: balance.id,
      employee_id: employeeId,
      year: balance.year,
      // Casual Leave breakdown
      cl_allocated: clAllocated,
      cl_used: clUsed,
      cl_balance: clBalance,
      // Earned Leave breakdown
      el_allocated: elAllocated,
      el_carried_forward: elCarried,
      el_used: elUsed,
      el_balance: elBalance,
      // Totals
      total_annual_entitlement: totalEntitlement,
      total_used: clUsed + elUsed,
      total_remaining_balance: totalRemaining,
      pending_requests: pendingCount,
      // Backward-compatible properties
      available: totalRemaining,
      used: clUsed + elUsed,
    };
  }

  /**
   * Apply for leave (CL, EL, LWP, or other) (Req 9.1, 9.2, 10).
   */
  async applyLeave(employeeId, leaveData, isAdminOnBehalf = false) {
    const { from_date, to_date, duration, reason, contact_during_leave, leave_type = 'cl' } = leaveData;

    const balanceData = await this.getLeaveBalance(employeeId);
    const reqDuration = Number(duration) || 1;

    // Check specific balance according to leave type
    const normalizedType = (leave_type || 'cl').toLowerCase();
    if (normalizedType === 'cl') {
      if (balanceData.cl_balance < reqDuration) {
        throw new AppError(
          `Insufficient Casual Leave (CL) balance. Available: ${balanceData.cl_balance} day(s), Requested: ${reqDuration} day(s).`,
          400
        );
      }
    } else if (normalizedType === 'el') {
      if (balanceData.el_balance < reqDuration) {
        throw new AppError(
          `Insufficient Earned Leave (EL) balance. Available: ${balanceData.el_balance} day(s), Requested: ${reqDuration} day(s).`,
          400
        );
      }
    }

    // Check for overlapping leave requests
    const overlapping = await LeaveRequest.findOne({
      where: {
        employee_id: employeeId,
        status: { [Op.in]: ['pending', 'approved'] },
        from_date: { [Op.lte]: to_date },
        to_date: { [Op.gte]: from_date },
      },
    });

    if (overlapping) {
      throw new AppError('You already have an active leave request covering this period', 409);
    }

    const leaveRequest = await LeaveRequest.create({
      employee_id: employeeId,
      leave_type: normalizedType,
      from_date,
      to_date,
      duration: reqDuration,
      reason,
      contact_during_leave,
      status: 'pending',
      is_paid: normalizedType !== 'lwp',
      payroll_treatment: 'pending',
    });

    logger.info(`Employee ID ${employeeId} applied for ${normalizedType.toUpperCase()} leave (${reqDuration} day(s))${isAdminOnBehalf ? ' [by admin]' : ''}`);
    return leaveRequest;
  }

  /**
   * Get leave requests for a specific employee.
   */
  async getLeaveRequests(employeeId, { page = 1, limit = PAGINATION.DEFAULT_LIMIT, status, search, from, to } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = { employee_id: employeeId };
    if (status) whereClause.status = status;
    if (from && to) {
      whereClause.from_date = { [Op.gte]: from };
      whereClause.to_date = { [Op.lte]: to };
    }

    const includeClause = [{
      model: Employee,
      as: 'employee',
      attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'profile_image'],
    }];

    const { rows, count } = await LeaveRequest.findAndCountAll({
      where: whereClause,
      include: includeClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * Get complete employee leave history for Admin view (Req 9.3).
   */
  async getEmployeeLeaveHistory(employeeId) {
    const employee = await Employee.findByPk(employeeId, {
      attributes: ['id', 'name', 'emp_code', 'designation', 'department', 'date_of_joining'],
    });
    if (!employee) throw new AppError('Employee not found', 404);

    const balance = await this.getLeaveBalance(employeeId);

    const history = await LeaveRequest.findAll({
      where: { employee_id: employeeId },
      include: [
        { model: Employee, as: 'approver', attributes: ['id', 'name', 'emp_code'] },
      ],
      order: [['from_date', 'DESC']],
    });

    return {
      employee,
      balance,
      history,
    };
  }

  /**
   * Cancel a pending leave request.
   */
  async cancelLeaveRequest(requestId, employeeId) {
    const request = await LeaveRequest.findOne({
      where: { id: requestId, employee_id: employeeId },
    });

    if (!request) throw new AppError('Leave request not found', 404);
    if (request.status !== 'pending') throw new AppError('Only pending leave requests can be cancelled', 400);

    await request.update({ status: 'cancelled' });
    logger.info(`Leave request ${requestId} cancelled by employee ${employeeId}`);
    return request;
  }

  /**
   * Get all leave requests (admin/hr/manager).
   */
  async getAllLeaveRequests({ page = 1, limit = PAGINATION.DEFAULT_LIMIT, status, department, search, from, to } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = {};
    if (status) whereClause.status = status;
    if (from && to) {
      whereClause.from_date = { [Op.gte]: from };
      whereClause.to_date = { [Op.lte]: to };
    }

    let employeeWhere = {};
    if (department) employeeWhere.department = department;
    if (search) {
      employeeWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await LeaveRequest.findAndCountAll({
      where: whereClause,
      include: [{
        model: Employee,
        as: 'employee',
        where: Object.keys(employeeWhere).length > 0 ? employeeWhere : undefined,
        attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'profile_image'],
      }, {
        model: Employee,
        as: 'approver',
        attributes: ['id', 'name', 'emp_code'],
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * Approve or reject a leave request (Req 4.3 & 10).
   * Supports explicit payrollTreatment:
   * - 'paid': Paid leave, balance deducted
   * - 'unpaid': Loss of Pay (LWP), no balance deducted, salary deducted in payroll
   * - 'adjusted_balance': Deduct from annual leave balance
   * - 'carry_forward_next': Defer deduction to following month
   */
  async approveLeaveRequest(requestId, action, remarks, approvedBy, payrollTreatment = null) {
    const request = await LeaveRequest.findByPk(requestId);
    if (!request) throw new AppError('Leave request not found', 404);

    if (request.status !== 'pending') {
      throw new AppError('Leave request is not in pending status', 400);
    }

    if (action !== 'approved' && action !== 'rejected') {
      throw new AppError('Action must be either "approved" or "rejected"', 400);
    }

    const treatment = payrollTreatment || (action === 'approved' ? (request.leave_type === 'lwp' ? 'unpaid' : 'adjusted_balance') : 'pending');

    await request.update({
      status: action,
      approved_by: approvedBy,
      approved_at: new Date(),
      remarks: remarks || '',
      payroll_treatment: treatment,
      is_paid: treatment !== 'unpaid',
    });

    // If approved and adjusted against balance, deduct from CL or EL
    if (action === 'approved' && treatment !== 'unpaid') {
      const balance = await this._ensureAnnualBalance(request.employee_id);
      const duration = Number(request.duration) || 1;

      if (request.leave_type === 'cl') {
        const newUsed = Number(balance.cl_used || 0) + duration;
        await balance.update({
          cl_used: newUsed,
          used: Number(balance.used || 0) + duration,
          available: Math.max(0, Number(balance.available || 0) - duration),
        });
      } else if (request.leave_type === 'el') {
        const newUsed = Number(balance.el_used || 0) + duration;
        await balance.update({
          el_used: newUsed,
          used: Number(balance.used || 0) + duration,
          available: Math.max(0, Number(balance.available || 0) - duration),
        });
      }
    }

    // Trigger Notification
    try {
      const fromFormatted = new Date(request.from_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const toFormatted = new Date(request.to_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const dateString = request.from_date === request.to_date ? fromFormatted : `${fromFormatted} to ${toFormatted}`;
      
      const title = action === 'approved' ? 'Leave Request Approved' : 'Leave Request Rejected';
      const msg = `Your ${request.leave_type.toUpperCase()} leave for ${dateString} has been ${action}. ${remarks ? `Remarks: ${remarks}` : ''}`;
      const type = action === 'approved' ? 'success' : 'error';

      await notificationService.createNotification(
        request.employee_id,
        title,
        msg,
        type,
        'leave',
        '/leave'
      );
    } catch (notifErr) {
      logger.error(`Failed to send leave notification: ${notifErr.message}`);
    }

    logger.info(`Leave request ${requestId} ${action} by ${approvedBy} with treatment: ${treatment}`);
    return request;
  }

  /**
   * Get team leaves for a manager (same department).
   */
  async getTeamLeaves(managerId, month, year) {
    const currentYear = year || new Date().getFullYear();
    const currentMonth = month || new Date().getMonth() + 1;

    const manager = await Employee.findByPk(managerId);
    if (!manager) throw new AppError('Manager not found', 404);

    const startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const leaves = await LeaveRequest.findAll({
      where: {
        status: 'approved',
        from_date: { [Op.lte]: endDate },
        to_date: { [Op.gte]: startDate },
      },
      include: [{
        model: Employee,
        as: 'employee',
        where: { department: manager.department },
        attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'profile_image'],
      }],
      order: [['from_date', 'ASC']],
    });

    return leaves;
  }

  /**
   * Get list of unique departments across all employees for filtering.
   */
  async getDepartments() {
    try {
      const results = await Employee.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('department')), 'department']],
        where: {
          department: {
            [Op.and]: [
              { [Op.ne]: null },
              { [Op.ne]: '' },
            ],
          },
        },
        raw: true,
      });

      const dbDepartments = results.map((r) => r.department).filter(Boolean);
      const defaultDepartments = [
        'Administration',
        'Engineering',
        'Finance',
        'Human Resources',
        'Marketing',
        'Operations',
        'Sales',
      ];
      const merged = Array.from(new Set([...defaultDepartments, ...dbDepartments])).sort();
      return merged;
    } catch (err) {
      logger.error('Failed to get departments in leave service:', err);
      return ['Administration', 'Human Resources', 'Operations', 'Sales', 'Marketing', 'Finance'];
    }
  }
}

module.exports = new LeaveService();