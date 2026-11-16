const { LeaveBalance, LeaveRequest, Employee, SystemSetting, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');
const notificationService = require('./notification.service');

const DEFAULT_LEAVE_POLICY = {
  pl: {
    name: 'Privilege / Earned Leave',
    code: 'PL/EL',
    entitlement: 12.0,
    carry_forward: true,
    max_carry_forward: 15.0,
    lapse: false,
    description: '12 days/year annual entitlement (combined PL / EL) with carry-forward permitted',
  },
  el: {
    name: 'Earned Leave (Merged with PL)',
    code: 'EL',
    entitlement: 0.0,
    carry_forward: false,
    max_carry_forward: 0.0,
    lapse: false,
    description: 'Merged with Privilege Leave into PL / EL (12 days total)',
  },
  cl: {
    name: 'Casual Leave',
    code: 'CL',
    entitlement: 12.0,
    carry_forward: false,
    max_carry_forward: 0.0,
    lapse: true,
    description: '12 days/year annual entitlement with lapse at year-end',
  },
  monthly_paid_limit: 2.0, // Maximum 2 paid leaves permitted per calendar month
};

class LeaveService {
  /**
   * Fetch current leave policy configuration (SystemSetting or default fallback).
   */
  async getLeavePolicy() {
    try {
      const setting = await SystemSetting.findOne({ where: { key: 'LEAVE_POLICY_CONFIG' } });
      if (setting && setting.value) {
        const parsed = JSON.parse(setting.value);
        return {
          pl: { ...DEFAULT_LEAVE_POLICY.pl, ...(parsed.pl || {}) },
          el: { ...DEFAULT_LEAVE_POLICY.el, ...(parsed.el || {}) },
          cl: { ...DEFAULT_LEAVE_POLICY.cl, ...(parsed.cl || {}) },
        };
      }
    } catch (err) {
      logger.warn('Failed to parse leave policy setting, returning defaults:', err.message);
    }
    return DEFAULT_LEAVE_POLICY;
  }

  /**
   * Update leave policy configuration (Admin).
   */
  async updateLeavePolicy(policyData) {
    const current = await this.getLeavePolicy();
    const merged = {
      pl: { ...current.pl, ...(policyData.pl || {}) },
      el: { ...current.el, ...(policyData.el || {}) },
      cl: { ...current.cl, ...(policyData.cl || {}) },
    };

    await SystemSetting.upsert({
      key: 'LEAVE_POLICY_CONFIG',
      value: JSON.stringify(merged),
    });

    logger.info('Leave policy configuration updated successfully');
    return merged;
  }

  /**
   * Helper: Ensure annual leave balance record exists for the employee.
   * Default Annual entitlement: 12 PL/EL + 12 CL = 24 days/year.
   * Combined PL & EL is 12 days total (carry-forward permitted). CL is 12 days (lapses annually).
   */
  async _ensureAnnualBalance(employeeId, targetYear = null) {
    const currentYear = targetYear || new Date().getFullYear();
    const policy = await this.getLeavePolicy();

    let balance = await LeaveBalance.findOne({
      where: { employee_id: employeeId },
    });

    if (!balance) {
      const plAlloc = Number(policy.pl?.entitlement ?? 12.00);
      const elAlloc = 0.00; // Merged into PL/EL
      const clAlloc = Number(policy.cl?.entitlement ?? 12.00);
      const totalAlloc = plAlloc + clAlloc; // 24.00

      balance = await LeaveBalance.create({
        employee_id: employeeId,
        year: currentYear,
        pl_allocated: plAlloc,
        pl_carried_forward: 0.00,
        pl_used: 0.00,
        pl_lapsed: 0.00,
        el_allocated: elAlloc,
        el_carried_forward: 0.00,
        el_used: 0.00,
        el_lapsed: 0.00,
        cl_allocated: clAlloc,
        cl_carried_forward: 0.00,
        cl_used: 0.00,
        cl_lapsed: 0.00,
        comp_off_balance: 0.00,
        available: Math.round(totalAlloc),
        used: 0,
        admin_granted: 0,
        lapsed: 0,
      });
    } else if (
      Number(balance.el_allocated) !== 0.00 ||
      Number(balance.el_carried_forward) !== 0.00 ||
      Number(balance.pl_carried_forward) === 12.00 ||
      Number(balance.pl_allocated) !== 12.00 ||
      Number(balance.cl_allocated) !== 12.00 ||
      Number(balance.available) > 24
    ) {
      // Strictly ensure PL/EL is 12 days total (not 12+12=24). el_allocated is 0. No phantom 12 CF.
      const plUsed = Number(balance.pl_used || 0) + Number(balance.el_used || 0);
      const clUsed = Number(balance.cl_used || 0);
      const compOff = Number(balance.comp_off_balance || 0);
      const totalAvail = Math.max(0, 24 - plUsed - clUsed + compOff);

      await balance.update({
        pl_allocated: 12.00,
        pl_carried_forward: 0.00,
        el_allocated: 0.00,
        el_carried_forward: 0.00,
        el_used: 0.00,
        el_lapsed: 0.00,
        cl_allocated: 12.00,
        cl_carried_forward: 0.00,
        available: totalAvail,
      });
    } else if (balance.year !== currentYear) {
      // Annual reset cycle applying approved carry-forward & lapse rules:
      // 1. Combined PL / EL: Carry-forward enabled up to max_carry_forward
      const totalPlElAlloc = Number(balance.pl_allocated || 12) + Number(balance.el_allocated || 0);
      const totalPlElCf = Number(balance.pl_carried_forward || 0) + Number(balance.el_carried_forward || 0);
      const totalPlElUsed = Number(balance.pl_used || 0) + Number(balance.el_used || 0);
      const unusedPl = Math.max(0, totalPlElAlloc + totalPlElCf - totalPlElUsed);
      const maxPlCf = policy.pl?.max_carry_forward ?? 15.0;
      const plCf = policy.pl?.carry_forward !== false ? Math.min(unusedPl, maxPlCf) : 0.0;
      const plLapsed = Math.max(0, unusedPl - plCf);

      // 2. CL: Lapses annually (no carry-forward)
      const unusedCl = Math.max(0, Number(balance.cl_allocated || 12) - Number(balance.cl_used || 0));
      const clCf = 0.0; // strictly 0 as CL lapses
      const clLapsed = unusedCl;

      const plAlloc = Number(policy.pl?.entitlement ?? 12.00); // 12 PL/EL
      const elAlloc = 0.00; // Merged into PL/EL
      const clAlloc = Number(policy.cl?.entitlement ?? 12.00); // 12 CL
      const compOffPreserved = Number(balance.comp_off_balance || 0);

      const totalAvail = Math.round(plAlloc + plCf + clAlloc + compOffPreserved);

      await balance.update({
        year: currentYear,
        pl_allocated: plAlloc,
        pl_carried_forward: plCf,
        pl_used: 0.00,
        pl_lapsed: plLapsed,
        el_allocated: elAlloc,
        el_carried_forward: 0.00,
        el_used: 0.00,
        el_lapsed: 0.00,
        cl_allocated: clAlloc,
        cl_carried_forward: 0.00,
        cl_used: 0.00,
        cl_lapsed: clLapsed,
        available: totalAvail,
        used: 0,
        lapsed: Math.round(plLapsed + clLapsed),
      });
    }

    return balance;
  }

  /**
   * Helper: Deduct leave from respective category.
   */
  async _deductFromBalance(balance, leaveType, duration) {
    const dur = Number(duration) || 1;
    const type = (leaveType || 'cl').toLowerCase();

    if (type === 'pl' || type === 'el' || type === 'pl_el') {
      const newUsed = Number(balance.pl_used || 0) + dur;
      await balance.update({
        pl_used: newUsed,
        used: Number(balance.used || 0) + dur,
        available: Math.max(0, Number(balance.available || 0) - dur),
      });
    } else if (type === 'cl') {
      const newUsed = Number(balance.cl_used || 0) + dur;
      await balance.update({
        cl_used: newUsed,
        used: Number(balance.used || 0) + dur,
        available: Math.max(0, Number(balance.available || 0) - dur),
      });
    } else if (type === 'comp_off') {
      const newBal = Math.max(0, Number(balance.comp_off_balance || 0) - dur);
      await balance.update({
        comp_off_balance: newBal,
        used: Number(balance.used || 0) + dur,
        available: Math.max(0, Number(balance.available || 0) - dur),
      });
    }
  }

  /**
   * Helper: Refund leave to respective category.
   */
  async _refundToBalance(balance, leaveType, duration) {
    const dur = Number(duration) || 1;
    const type = (leaveType || 'cl').toLowerCase();

    if (type === 'pl' || type === 'el' || type === 'pl_el') {
      const newUsed = Math.max(0, Number(balance.pl_used || 0) - dur);
      await balance.update({
        pl_used: newUsed,
        used: Math.max(0, Number(balance.used || 0) - dur),
        available: Number(balance.available || 0) + dur,
      });
    } else if (type === 'cl') {
      const newUsed = Math.max(0, Number(balance.cl_used || 0) - dur);
      await balance.update({
        cl_used: newUsed,
        used: Math.max(0, Number(balance.used || 0) - dur),
        available: Number(balance.available || 0) + dur,
      });
    } else if (type === 'comp_off') {
      const newBal = Number(balance.comp_off_balance || 0) + dur;
      await balance.update({
        comp_off_balance: newBal,
        used: Math.max(0, Number(balance.used || 0) - dur),
        available: Number(balance.available || 0) + dur,
      });
    }
  }

  /**
   * Get annual leave balance and entitlement for an employee.
   * Policy: 12 PL/EL + 12 CL = 24 Total Annual Paid Leaves.
   * Monthly Limit: Maximum 2 paid leaves per calendar month.
   */
  async getLeaveBalance(employeeId, targetYear = null) {
    const balance = await this._ensureAnnualBalance(employeeId, targetYear);
    const policy = await this.getLeavePolicy();
    const emp = await Employee.findByPk(employeeId, { attributes: ['id', 'is_leave_allowed'] });
    const isLeaveAllowed = emp ? emp.is_leave_allowed !== false : true;

    // Privilege / Earned Leave (PL / EL) Breakdown (strictly 12 days/year annual quota)
    const plElAllocated = 12.0;
    const plElCarried = Number(balance.pl_carried_forward || 0.0);
    const plElUsed = Number(balance.pl_used || 0.0);
    const plElLapsed = Number(balance.pl_lapsed || 0.0);
    const plElBalance = Math.max(0, (plElAllocated + plElCarried) - plElUsed - plElLapsed);

    // Casual Leave (CL) Breakdown (strictly 12 days/year annual quota, lapses annually)
    const clAllocated = 12.0;
    const clCarried = 0.0;
    const clUsed = Number(balance.cl_used || 0.0);
    const clLapsed = Number(balance.cl_lapsed || 0.0);
    const clBalance = Math.max(0, clAllocated - clUsed - clLapsed);

    // Comp-off balance
    const compOffBal = Number(balance.comp_off_balance || 0.0);

    // Pending leave requests count
    const pendingCount = await LeaveRequest.count({
      where: { employee_id: employeeId, status: 'pending' },
    });

    // Total Annual Entitlement = strictly 12 (PL/EL) + 12 (CL) = 24 days total (+ genuine carried forward)
    const totalPaidEntitlement = 24.0 + plElCarried;
    const totalUsed = plElUsed + clUsed;
    const totalRemaining = plElBalance + clBalance + compOffBal;

    // Monthly Paid Leave Usage Calculation for current month (Max 2 paid leaves / calendar month)
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const monthStart = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(curYear, curMonth, 0).getDate();
    const monthEnd = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const currentMonthPaidLeaves = await LeaveRequest.findAll({
      where: {
        employee_id: employeeId,
        status: { [Op.in]: ['pending', 'approved'] },
        is_paid: true,
        from_date: { [Op.lte]: monthEnd },
        to_date: { [Op.gte]: monthStart },
      },
    });

    let paidTakenThisMonth = 0;
    for (const req of currentMonthPaidLeaves) {
      paidTakenThisMonth += this._apportionLeaveDaysToMonth(req, curYear, curMonth);
    }
    paidTakenThisMonth = Math.round(paidTakenThisMonth * 10) / 10;
    const monthlyPaidLimit = 2.0;
    const paidRemainingThisMonth = Math.max(0, Math.round((monthlyPaidLimit - paidTakenThisMonth) * 10) / 10);

    return {
      id: balance.id,
      employee_id: employeeId,
      year: balance.year,
      is_leave_allowed: isLeaveAllowed,
      // Combined PL / EL breakdown
      pl_el_allocated: plElAllocated,
      pl_el_carried_forward: plElCarried,
      pl_el_used: plElUsed,
      pl_el_lapsed: plElLapsed,
      pl_el_balance: plElBalance,
      // Aliases for backward compatibility with PL & EL callers
      pl_allocated: plElAllocated,
      pl_carried_forward: plElCarried,
      pl_used: plElUsed,
      pl_lapsed: plElLapsed,
      pl_balance: plElBalance,
      el_allocated: 0.0,
      el_carried_forward: 0.0,
      el_used: 0.0,
      el_lapsed: 0.0,
      el_balance: plElBalance,
      // Casual Leave (CL) breakdown
      cl_allocated: clAllocated,
      cl_carried_forward: clCarried,
      cl_used: clUsed,
      cl_lapsed: clLapsed,
      cl_balance: clBalance,
      // Compensatory Off (Comp-Off)
      comp_off_balance: compOffBal,
      // Monthly Paid Leave Policy Limits (Max 2 Paid Leaves / Month)
      monthly_paid_leave_limit: monthlyPaidLimit,
      paid_leaves_taken_this_month: paidTakenThisMonth,
      paid_leaves_remaining_this_month: paidRemainingThisMonth,
      // Totals (12 PL/EL + 12 CL = 24 Total)
      total_annual_entitlement: 24.0,
      total_paid_entitlement: totalPaidEntitlement,
      total_used: totalUsed,
      total_remaining_balance: totalRemaining,
      pending_requests: pendingCount,
      // Policy configuration metadata
      carry_forward_info: {
        pl_el: { enabled: true, carried_forward: plElCarried, max_allowed: policy.pl?.max_carry_forward ?? 15 },
        cl: { enabled: false, carried_forward: 0, rule: 'Lapses annually at year-end' },
      },
      lapse_info: {
        cl_lapse_enabled: true,
        cl_lapsed: clLapsed,
        pl_el_lapsed: plElLapsed,
      },
      // Backward-compatible properties
      available: totalRemaining,
      used: totalUsed,
      total_entitled: totalPaidEntitlement,
      total_balance: totalRemaining,
    };
  }

  /**
   * Apply for leave (PL / EL, CL, Comp-Off, LWP).
   * Enforces:
   * 1. Total Annual Entitlement: 12 PL/EL + 12 CL = 24 Total
   * 2. Monthly Limit: Max 2 paid leaves per calendar month
   */
  async applyLeave(employeeId, leaveData, isAdminOnBehalf = false) {
    if (!isAdminOnBehalf) {
      const emp = await Employee.findByPk(employeeId, { attributes: ['id', 'is_leave_allowed'] });
      if (emp && emp.is_leave_allowed === false) {
        throw new AppError('Leave requests are currently disabled for your account by administration. Please contact your HR manager.', 403);
      }
    }

    const { from_date, to_date, duration, reason, contact_during_leave, leave_type = 'pl_el' } = leaveData;

    const balanceData = await this.getLeaveBalance(employeeId);
    const reqDuration = Number(duration) || 1;

    // Normalize leave type: 'pl', 'el', 'pl_el' all map to unified PL / EL
    let normalizedType = (leave_type || 'pl_el').toLowerCase();
    if (normalizedType === 'pl' || normalizedType === 'el') {
      normalizedType = 'pl_el';
    }

    // Check specific balance according to leave category (12 PL/EL, 12 CL)
    if (normalizedType === 'pl_el') {
      if (balanceData.pl_el_balance < reqDuration) {
        throw new AppError(
          `Insufficient PL / EL balance. Available: ${balanceData.pl_el_balance} day(s), Requested: ${reqDuration} day(s).`,
          400
        );
      }
    } else if (normalizedType === 'cl') {
      if (balanceData.cl_balance < reqDuration) {
        throw new AppError(
          `Insufficient Casual Leave (CL) balance. Available: ${balanceData.cl_balance} day(s), Requested: ${reqDuration} day(s).`,
          400
        );
      }
    } else if (normalizedType === 'comp_off') {
      if (balanceData.comp_off_balance < reqDuration) {
        throw new AppError(
          `Insufficient Comp-Off balance. Available: ${balanceData.comp_off_balance} day(s), Requested: ${reqDuration} day(s).`,
          400
        );
      }
    }

    // ── Monthly Paid Leave Restriction: Maximum 2 Paid Leaves per Calendar Month ──
    // Unpaid leaves (LWP) are excluded from the 2-day paid limit.
    // Paid leaves (PL / EL, CL, Comp-Off) are restricted to max 2.0 days in any calendar month.
    if (normalizedType !== 'lwp') {
      const from = new Date(from_date);
      const to = new Date(to_date);

      const startYear = from.getFullYear();
      const startMonth = from.getMonth() + 1;
      const endYear = to.getFullYear();
      const endMonth = to.getMonth() + 1;

      const MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      let curY = startYear;
      let curM = startMonth;

      while (curY < endYear || (curY === endYear && curM <= endMonth)) {
        const mStart = `${curY}-${String(curM).padStart(2, '0')}-01`;
        const lastDay = new Date(curY, curM, 0).getDate();
        const mEnd = `${curY}-${String(curM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // Number of days in THIS leave request that fall within month (curY, curM)
        const requestedDaysInMonth = this._apportionLeaveDaysToMonth(
          { from_date, to_date, duration: reqDuration },
          curY,
          curM
        );

        if (requestedDaysInMonth > 0) {
          // Fetch existing active (pending or approved) paid leaves for this employee overlapping this month
          const existingPaidLeaves = await LeaveRequest.findAll({
            where: {
              employee_id: employeeId,
              status: { [Op.in]: ['pending', 'approved'] },
              is_paid: true,
              from_date: { [Op.lte]: mEnd },
              to_date: { [Op.gte]: mStart },
            },
          });

          let existingDaysInMonth = 0;
          for (const exReq of existingPaidLeaves) {
            existingDaysInMonth += this._apportionLeaveDaysToMonth(exReq, curY, curM);
          }
          existingDaysInMonth = Math.round(existingDaysInMonth * 10) / 10;

          const totalPaidAfterRequest = Math.round((existingDaysInMonth + requestedDaysInMonth) * 10) / 10;
          const monthLabel = `${MONTH_NAMES[curM - 1]} ${curY}`;

          if (totalPaidAfterRequest > 2.0) {
            throw new AppError(
              `Monthly paid leave limit exceeded: Maximum 2 paid leaves are permitted per calendar month. For ${monthLabel}, you already have ${existingDaysInMonth} day(s) taken/pending. Adding ${requestedDaysInMonth} day(s) would make ${totalPaidAfterRequest} days, which exceeds the monthly limit of 2 days.`,
              400
            );
          }
        }

        // Advance to next month
        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }
    }

    // Check for overlapping active leave requests
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
   * Helper: Distribute leave days across months for multi-day or boundary-crossing leaves.
   */
  _apportionLeaveDaysToMonth(leaveReq, targetYear, targetMonth) {
    const from = new Date(leaveReq.from_date);
    const to = new Date(leaveReq.to_date);
    const totalDays = Number(leaveReq.duration) || 1;

    // Range of target month
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0); // Last day of month

    if (to < monthStart || from > monthEnd) {
      return 0; // Does not intersect this month
    }

    // Overlapping interval
    const effStart = from < monthStart ? monthStart : from;
    const effEnd = to > monthEnd ? monthEnd : to;

    // Total calendar days in the entire leave request
    const totalSpanDays = Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1);
    // Overlapping calendar days in target month
    const effDays = Math.max(1, Math.round((effEnd - effStart) / (1000 * 60 * 60 * 24)) + 1);

    if (totalSpanDays === effDays) {
      return totalDays; // Entire leave falls within this month
    }

    // Prorate duration across months proportionally
    const prorated = Math.round((effDays / totalSpanDays) * totalDays * 10) / 10;
    return prorated;
  }

  /**
   * Get complete employee leave history with month-wise breakdown (Req 2.6).
   * Allows authorized users to review how many days an employee took off in a selected month
   * (e.g. October, November, or any requested month).
   */
  async getEmployeeLeaveHistory(employeeId, { year, month } = {}) {
    const employee = await Employee.findByPk(employeeId, {
      attributes: ['id', 'name', 'emp_code', 'designation', 'department', 'date_of_joining', 'email', 'phone'],
    });
    if (!employee) throw new AppError('Employee not found', 404);

    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : null;

    const balance = await this.getLeaveBalance(employeeId, targetYear);

    // Fetch all requests for this employee
    const history = await LeaveRequest.findAll({
      where: { employee_id: employeeId },
      include: [
        { model: Employee, as: 'approver', attributes: ['id', 'name', 'emp_code'] },
      ],
      order: [['from_date', 'DESC']],
    });

    const approvedRequests = history.filter(r => r.status === 'approved');
    const pendingRequests = history.filter(r => r.status === 'pending');
    const rejectedRequests = history.filter(r => r.status === 'rejected');

    const totalDaysTaken = approvedRequests.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    const pendingDays = pendingRequests.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);

    // Month names for 12 months distribution
    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Compute 12-month leave history distribution matrix
    const monthlyDistribution = MONTH_NAMES.map((name, idx) => {
      const mNum = idx + 1;
      const monthPad = String(mNum).padStart(2, '0');
      const monthKey = `${targetYear}-${monthPad}`;

      let mTotalDays = 0;
      let mPlDays = 0;
      let mElDays = 0;
      let mClDays = 0;
      let mLwpDays = 0;
      let mCompOffDays = 0;
      let mHalfDays = 0;
      let mRecordsCount = 0;

      for (const req of approvedRequests) {
        const daysInMonth = this._apportionLeaveDaysToMonth(req, targetYear, mNum);
        if (daysInMonth > 0) {
          mTotalDays += daysInMonth;
          mRecordsCount++;
          if (Number(req.duration) === 0.5) mHalfDays++;

          const type = (req.leave_type || 'cl').toLowerCase();
          if (type === 'pl' || type === 'el' || type === 'pl_el') mPlDays += daysInMonth;
          else if (type === 'cl') mClDays += daysInMonth;
          else if (type === 'lwp') mLwpDays += daysInMonth;
          else if (type === 'comp_off') mCompOffDays += daysInMonth;
        }
      }

      return {
        month: mNum,
        month_key: monthKey,
        month_name: name,
        total_days_off: Math.round(mTotalDays * 10) / 10,
        pl_el_days: Math.round(mPlDays * 10) / 10,
        pl_days: Math.round(mPlDays * 10) / 10,
        el_days: 0,
        cl_days: Math.round(mClDays * 10) / 10,
        lwp_days: Math.round(mLwpDays * 10) / 10,
        comp_off_days: Math.round(mCompOffDays * 10) / 10,
        half_days: mHalfDays,
        records_count: mRecordsCount,
        monthly_paid_limit: 2.0,
      };
    });

    // If specific month was queried (e.g. October = 10, November = 11), build detailed selected month payload
    let selectedMonthSummary = null;
    let selectedMonthRecords = [];

    if (targetMonth && targetMonth >= 1 && targetMonth <= 12) {
      const distItem = monthlyDistribution[targetMonth - 1];
      selectedMonthRecords = history.filter(req => {
        return this._apportionLeaveDaysToMonth(req, targetYear, targetMonth) > 0;
      });

      selectedMonthSummary = {
        ...distItem,
        records: selectedMonthRecords,
      };
    }

    return {
      employee,
      balance,
      summary: {
        total_leave_taken: totalDaysTaken,
        approved_count: approvedRequests.length,
        approved_days: totalDaysTaken,
        pending_count: pendingRequests.length,
        pending_days: pendingDays,
        rejected_count: rejectedRequests.length,
        total_paid_entitlement: balance.total_paid_entitlement,
        pl_balance: balance.pl_balance,
        el_balance: balance.el_balance,
        cl_balance: balance.cl_balance,
        comp_off_balance: balance.comp_off_balance,
        remaining_leave_balance: balance.total_remaining_balance,
        applicable_balance: balance.total_remaining_balance,
        carry_forward_info: balance.carry_forward_info,
        lapse_info: balance.lapse_info,
      },
      monthly_distribution: monthlyDistribution,
      selected_month: selectedMonthSummary,
      history,
    };
  }

  /**
   * Get all active employees leave summary (Admin Master View - Req 2.6).
   * Displays: Employee ID, Employee Name, Total Paid Leave Entitlement,
   * PL Balance, EL Balance, CL Balance, Total Leave Taken, Remaining Leave Balance,
   * Carry-Forward / Lapse Information, and Month-wise days taken.
   */
  async getAllEmployeesLeaveSummary({ year, department, search, month, page = 1, limit = 50 } = {}) {
    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : null;
    const offset = (page - 1) * limit;

    const whereClause = { status: 'active' };
    if (department && department !== 'All Branches' && department !== 'All Departments') {
      whereClause.department = department;
    }
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows: employees, count } = await Employee.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'date_of_joining'],
      order: [['emp_code', 'ASC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const empIds = employees.map(e => e.id);

    // Fetch leave balances for target year
    const balances = await LeaveBalance.findAll({
      where: { employee_id: { [Op.in]: empIds } },
    });
    const balanceMap = new Map();
    balances.forEach(b => balanceMap.set(b.employee_id, b));

    // Fetch approved leaves if month filter is specified
    let monthLeavesMap = new Map();
    if (targetMonth) {
      const monthStart = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
      const lastDay = new Date(targetYear, targetMonth, 0).getDate();
      const monthEnd = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const leaves = await LeaveRequest.findAll({
        where: {
          employee_id: { [Op.in]: empIds },
          status: 'approved',
          from_date: { [Op.lte]: monthEnd },
          to_date: { [Op.gte]: monthStart },
        },
      });

      leaves.forEach(l => {
        if (!monthLeavesMap.has(l.employee_id)) monthLeavesMap.set(l.employee_id, []);
        monthLeavesMap.get(l.employee_id).push(l);
      });
    }

    const policy = await this.getLeavePolicy();

    const data = employees.map(emp => {
      const bal = balanceMap.get(emp.id);

      const plAlloc = bal ? Number(bal.pl_allocated != null ? bal.pl_allocated : 12.0) : 12.0;
      const plCf = bal ? Number(bal.pl_carried_forward || 0.0) : 0.0;
      const plUsed = bal ? Number(bal.pl_used || 0.0) : 0.0;
      const plLapsed = bal ? Number(bal.pl_lapsed || 0.0) : 0.0;

      const elAlloc = bal ? Number(bal.el_allocated || 0.0) : 0.0;
      const elCf = bal ? Number(bal.el_carried_forward || 0.0) : 0.0;
      const elUsed = bal ? Number(bal.el_used || 0.0) : 0.0;
      const elLapsed = bal ? Number(bal.el_lapsed || 0.0) : 0.0;

      // Combined PL / EL (strictly 12 days total)
      const plElAlloc = 12.0;
      const plElCf = Number(bal?.pl_carried_forward || 0.0);
      const plElUsed = Number(bal?.pl_used || 0.0);
      const plElLapsed = Number(bal?.pl_lapsed || 0.0);
      const plElBal = Math.max(0, (plElAlloc + plElCf) - plElUsed - plElLapsed);

      const clAlloc = 12.0;
      const clUsed = Number(bal?.cl_used || 0.0);
      const clLapsed = Number(bal?.cl_lapsed || 0.0);
      const clBal = Math.max(0, clAlloc - clUsed - clLapsed);

      const compOffBal = Number(bal?.comp_off_balance || 0.0);

      // Total Paid Entitlement = 12 (PL/EL) + 12 (CL) = 24 Total (+ CF)
      const totalPaidEntitlement = 24.0 + plElCf;
      const totalTaken = plElUsed + clUsed;
      const remainingBalance = plElBal + clBal + compOffBal;

      // Month specific stats if requested
      let monthDaysTaken = 0;
      let monthPlDays = 0;
      let monthElDays = 0;
      let monthClDays = 0;
      let monthLwpDays = 0;

      if (targetMonth) {
        const empMonthLeaves = monthLeavesMap.get(emp.id) || [];
        for (const req of empMonthLeaves) {
          const daysInMonth = this._apportionLeaveDaysToMonth(req, targetYear, targetMonth);
          if (daysInMonth > 0) {
            monthDaysTaken += daysInMonth;
            const type = (req.leave_type || 'cl').toLowerCase();
            if (type === 'pl' || type === 'el' || type === 'pl_el') monthPlDays += daysInMonth;
            else if (type === 'cl') monthClDays += daysInMonth;
            else if (type === 'lwp') monthLwpDays += daysInMonth;
          }
        }
      }

      return {
        id: emp.id,
        employee_id: emp.id,
        emp_code: emp.emp_code,
        name: emp.name,
        department: emp.department || '—',
        designation: emp.designation || 'Staff',
        date_of_joining: emp.date_of_joining,
        is_leave_allowed: emp.is_leave_allowed !== false,
        total_paid_entitlement: totalPaidEntitlement,
        // Combined PL / EL
        pl_el_balance: plElBal,
        pl_el_allocated: plElAlloc,
        pl_el_carried_forward: plElCf,
        pl_el_used: plElUsed,
        // Backward compatibility aliases
        pl_balance: plElBal,
        pl_allocated: plElAlloc,
        pl_carried_forward: plElCf,
        pl_used: plElUsed,
        el_balance: plElBal,
        el_allocated: 0.0,
        el_carried_forward: 0.0,
        el_used: 0.0,
        cl_balance: clBal,
        cl_allocated: clAlloc,
        cl_used: clUsed,
        cl_lapsed: clLapsed,
        comp_off_balance: compOffBal,
        total_leave_taken: totalTaken,
        remaining_leave_balance: remainingBalance,
        monthly_paid_limit: 2.0,
        carry_forward_info: {
          pl_el_carry_forward: true,
          pl_el_carried_forward: plElCf,
          cl_carry_forward: false,
        },
        lapse_info: {
          cl_lapse_enabled: true,
          cl_lapsed: clLapsed,
        },
        selected_month_data: targetMonth ? {
          month: targetMonth,
          month_name: new Date(targetYear, targetMonth - 1, 1).toLocaleString('en-US', { month: 'long' }),
          days_taken: Math.round(monthDaysTaken * 10) / 10,
          pl_el_days: Math.round(monthPlDays * 10) / 10,
          pl_days: Math.round(monthPlDays * 10) / 10,
          el_days: 0,
          cl_days: Math.round(monthClDays * 10) / 10,
          lwp_days: Math.round(monthLwpDays * 10) / 10,
        } : null,
      };
    });

    return {
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
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
    if (department && department !== 'All Branches') employeeWhere.department = department;
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
   * Approve or reject a leave request (Req 2.6 & Req 10).
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

    // If approved and adjusted against balance, deduct from respective category (PL, EL, CL, Comp-Off)
    if (action === 'approved' && treatment !== 'unpaid') {
      const balance = await this._ensureAnnualBalance(request.employee_id);
      await this._deductFromBalance(balance, request.leave_type, request.duration);
    }

    // Sync monthly attendance immediately
    try {
      const attendanceService = require('./attendance.service');
      await attendanceService._updateMonthlyAttendance(request.employee_id, request.from_date);
    } catch (attErr) {
      logger.error(`Failed to update monthly attendance on leave action: ${attErr.message}`);
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
   * Update or override payroll treatment for an existing leave request (Req 10).
   */
  async updateLeavePayrollTreatment(requestId, { payroll_treatment, remarks, is_paid, updatedBy }) {
    const request = await LeaveRequest.findByPk(requestId);
    if (!request) throw new AppError('Leave request not found', 404);

    const validTreatments = ['paid', 'unpaid', 'adjusted_balance', 'deducted_current', 'carry_forward_next'];
    if (!validTreatments.includes(payroll_treatment)) {
      throw new AppError(`Invalid payroll treatment: ${payroll_treatment}. Valid choices: ${validTreatments.join(', ')}`, 400);
    }

    const prevTreatment = request.payroll_treatment;
    const prevIsPaid = request.is_paid;
    const duration = Number(request.duration) || 1;
    const finalIsPaid = is_paid !== undefined ? Boolean(is_paid) : (payroll_treatment !== 'unpaid' && payroll_treatment !== 'deducted_current');

    // Balance adjustments if transitioning between paid/adjusted_balance and unpaid
    const balance = await this._ensureAnnualBalance(request.employee_id);
    const wasDeductedFromBalance = prevTreatment === 'adjusted_balance' || (prevTreatment === 'paid' && prevIsPaid);
    const nowDeductsFromBalance = payroll_treatment === 'adjusted_balance' || (payroll_treatment === 'paid' && finalIsPaid);

    if (wasDeductedFromBalance && !nowDeductsFromBalance) {
      // Refund balance
      await this._refundToBalance(balance, request.leave_type, duration);
    } else if (!wasDeductedFromBalance && nowDeductsFromBalance) {
      // Consume from balance
      await this._deductFromBalance(balance, request.leave_type, duration);
    }

    const updateData = {
      payroll_treatment,
      is_paid: finalIsPaid,
    };
    if (remarks) {
      updateData.remarks = remarks;
    }
    await request.update(updateData);

    // Sync monthly attendance immediately
    try {
      const attendanceService = require('./attendance.service');
      await attendanceService._updateMonthlyAttendance(request.employee_id, request.from_date);
    } catch (attErr) {
      logger.error(`Failed to update monthly attendance on treatment update: ${attErr.message}`);
    }

    logger.info(`Leave request ${requestId} payroll treatment updated to ${payroll_treatment} by admin ${updatedBy}`);
    return request;
  }

  /**
   * Year-end Rollover & Lapse execution across all active employees (Req 2.6).
   */
  async applyYearEndRollover({ fromYear, toYear } = {}) {
    const fYear = fromYear || new Date().getFullYear();
    const tYear = toYear || fYear + 1;

    const activeEmployees = await Employee.findAll({
      where: { status: 'active' },
      attributes: ['id', 'emp_code', 'name'],
    });

    let processedCount = 0;
    for (const emp of activeEmployees) {
      await this._ensureAnnualBalance(emp.id, tYear);
      processedCount++;
    }

    logger.info(`Annual leave rollover executed from ${fYear} to ${tYear} for ${processedCount} employees`);
    return {
      message: `Annual leave rollover successfully applied for ${processedCount} employees from year ${fYear} to ${tYear}`,
      processed_count: processedCount,
      from_year: fYear,
      to_year: tYear,
    };
  }

  /**
   * Grant extra leaves to an employee by Admin.
   */
  async grantExtraLeaves(adminId, employeeId, count, reason) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) throw new AppError('Employee not found', 404);

    const balance = await this._ensureAnnualBalance(employeeId);
    const grantAmount = Number(count) || 1;

    // Credit to comp_off_balance & admin_granted
    const newCompOff = Number(balance.comp_off_balance || 0) + grantAmount;
    const newAdminGranted = Number(balance.admin_granted || 0) + grantAmount;
    const newAvail = Number(balance.available || 0) + grantAmount;

    await balance.update({
      comp_off_balance: newCompOff,
      admin_granted: newAdminGranted,
      available: newAvail,
    });

    logger.info(`Admin ${adminId} granted ${grantAmount} extra leaves to employee ${employeeId}. Reason: ${reason}`);
    return {
      employee_id: employeeId,
      granted_count: grantAmount,
      comp_off_balance: newCompOff,
      total_remaining_balance: Number(balance.available || 0),
      reason,
    };
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
