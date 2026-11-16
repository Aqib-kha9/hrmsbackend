const { AttendanceRegularization, AttendanceRecord, Employee, Office, Company, Notification, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const attendanceService = require('./attendance.service');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

/**
 * Returns current date in YYYY-MM-DD in local timezone
 */
const getLocalDateString = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
};

class RegularizationService {
  /**
   * Employee applies for attendance regularisation
   */
  async applyRegularization(employeeId, data) {
    const { date, regularization_type, requested_check_in, requested_check_out, reason } = data;

    // Validate employee exists
    const employee = await Employee.findByPk(employeeId, {
      attributes: ['id', 'name', 'emp_code', 'company_id', 'office_id', 'department'],
    });
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    // Format date string
    const dateStr = String(date).split('T')[0];
    const todayStr = getLocalDateString();

    if (dateStr > todayStr) {
      throw new AppError('Cannot request regularisation for a future date', 400);
    }

    // Check duplicate pending request for this employee on this date
    const existingPending = await AttendanceRegularization.findOne({
      where: {
        employee_id: employeeId,
        date: dateStr,
        status: 'pending',
      },
    });

    if (existingPending) {
      throw new AppError('A pending regularisation request already exists for this date. Please wait for HR review or cancel the existing request.', 400);
    }

    // Check if an existing AttendanceRecord is already present on this date
    const existingRecord = await AttendanceRecord.findOne({
      where: { employee_id: employeeId, date: dateStr },
    });

    // Default times if omitted
    const reqIn = requested_check_in || (regularization_type === 'forgot_check_out' ? (existingRecord?.check_in_time || '09:30:00') : '09:30:00');
    const reqOut = requested_check_out || (regularization_type === 'forgot_check_in' ? (existingRecord?.check_out_time || '18:30:00') : '18:30:00');

    const regularization = await AttendanceRegularization.create({
      employee_id: employeeId,
      attendance_record_id: existingRecord ? existingRecord.id : null,
      date: dateStr,
      regularization_type: regularization_type || 'forgot_punch',
      requested_check_in: reqIn,
      requested_check_out: reqOut,
      reason: reason.trim(),
      status: 'pending',
    });

    // Notify HR / Admins
    try {
      const hrAdmins = await Employee.findAll({
        where: {
          role: { [Op.in]: ['admin', 'super_admin', 'hr', 'hr_manager', 'ADMIN', 'SUPER_ADMIN', 'HR'] },
          status: 'active',
        },
        attributes: ['id'],
      });

      for (const admin of hrAdmins) {
        await Notification.create({
          employee_id: admin.id,
          title: 'New Regularisation Request ⏰',
          message: `${employee.name} (${employee.emp_code}) requested attendance regularisation for ${dateStr}.`,
          type: 'info',
          category: 'attendance',
          action_url: '/attendance?tab=regularize',
        });
      }
    } catch (notifErr) {
      logger.warn('Failed to send HR notifications for regularisation:', notifErr.message);
    }

    logger.info(`Employee ${employee.emp_code} submitted regularisation request for ${dateStr}`);
    return regularization;
  }

  /**
   * Employee gets their own regularisation requests
   */
  async getMyRegularizations(employeeId, query = {}) {
    const where = { employee_id: employeeId };

    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    if (query.month && query.year) {
      const m = String(query.month).padStart(2, '0');
      const y = String(query.year);
      where.date = {
        [Op.between]: [`${y}-${m}-01`, `${y}-${m}-31`],
      };
    }

    const requests = await AttendanceRegularization.findAll({
      where,
      include: [
        {
          model: Employee,
          as: 'approver',
          attributes: ['id', 'name', 'emp_code'],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return requests;
  }

  /**
   * Employee cancels their own pending regularisation request
   */
  async cancelRegularization(employeeId, requestId) {
    const request = await AttendanceRegularization.findOne({
      where: { id: requestId, employee_id: employeeId },
    });

    if (!request) {
      throw new AppError('Regularisation request not found', 404);
    }

    if (request.status !== 'pending') {
      throw new AppError(`Cannot cancel request with status "${request.status}"`, 400);
    }

    await request.update({ status: 'cancelled' });
    logger.info(`Employee ${employeeId} cancelled regularisation request #${requestId}`);
    return request;
  }

  /**
   * HR / Admin gets all regularisation requests with filters, summary counts, and pagination
   */
  async getAllRegularizations(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    if (query.month && query.year) {
      const m = String(query.month).padStart(2, '0');
      const y = String(query.year);
      where.date = {
        [Op.between]: [`${y}-${m}-01`, `${y}-${m}-31`],
      };
    }

    // Employee filters
    const empWhere = {};
    if (query.company_id) {
      empWhere.company_id = query.company_id;
    }
    if (query.office_id) {
      empWhere.office_id = query.office_id;
    }
    if (query.department && query.department !== 'All') {
      empWhere.department = query.department;
    }
    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      empWhere[Op.or] = [
        { name: { [Op.like]: term } },
        { emp_code: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }

    const { count, rows } = await AttendanceRegularization.findAndCountAll({
      where,
      include: [
        {
          model: Employee,
          as: 'employee',
          where: Object.keys(empWhere).length > 0 ? empWhere : undefined,
          attributes: ['id', 'name', 'emp_code', 'email', 'avatar', 'department', 'designation', 'company_id', 'office_id'],
          include: [
            { model: Company, as: 'company', attributes: ['id', 'name'] },
            { model: Office, as: 'office', attributes: ['id', 'name', 'city'] },
          ],
        },
        {
          model: Employee,
          as: 'approver',
          attributes: ['id', 'name', 'emp_code'],
        },
        {
          model: AttendanceRecord,
          as: 'attendanceRecord',
          attributes: ['id', 'status', 'check_in_time', 'check_out_time', 'total_hours', 'check_in_method', 'is_regularized'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    // Summary counts for dashboard badges
    const [pendingCount, approvedCount, rejectedCount, totalCount] = await Promise.all([
      AttendanceRegularization.count({ where: { status: 'pending' } }),
      AttendanceRegularization.count({ where: { status: 'approved' } }),
      AttendanceRegularization.count({ where: { status: 'rejected' } }),
      AttendanceRegularization.count(),
    ]);

    return {
      requests: rows,
      pagination: {
        page,
        limit,
        totalItems: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
      summary: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: totalCount,
      },
    };
  }

  /**
   * HR / Admin reviews (Approves or Rejects) a regularisation request
   */
  async reviewRegularization(approverId, requestId, { action, admin_remarks, status }) {
    const request = await AttendanceRegularization.findByPk(requestId, {
      include: [
        {
          model: Employee,
          as: 'employee',
          attributes: ['id', 'name', 'emp_code', 'email'],
        },
      ],
    });

    if (!request) {
      throw new AppError('Regularisation request not found', 404);
    }

    if (request.status !== 'pending') {
      throw new AppError(`Cannot review request that is already "${request.status}"`, 400);
    }

    if (action !== 'approved' && action !== 'rejected') {
      throw new AppError('Action must be either "approved" or "rejected"', 400);
    }

    const approver = await Employee.findByPk(approverId, { attributes: ['id', 'name', 'emp_code'] });

    if (action === 'rejected') {
      await request.update({
        status: 'rejected',
        approved_by: approverId,
        approved_at: new Date(),
        admin_remarks: admin_remarks || 'Rejected by HR',
      });

      // Send rejection notification to employee
      try {
        await Notification.create({
          employee_id: request.employee_id,
          title: 'Regularisation Request Rejected ❌',
          message: `Your regularisation request for ${request.date} was rejected by ${approver?.name || 'HR'}. Remarks: ${admin_remarks || 'Not approved'}`,
          type: 'warning',
          category: 'attendance',
          action_url: '/attendance',
        });
      } catch (notifErr) {
        logger.warn('Failed to send rejection notification:', notifErr.message);
      }

      logger.info(`Regularisation request #${requestId} rejected by approver ${approverId}`);
      return request;
    }

    // ── Action is "approved" ──
    const targetStatus = (status && ['present', 'half_day'].includes(status)) ? status : 'present';
    const checkIn = request.requested_check_in || '09:30:00';
    const checkOut = request.requested_check_out || '18:30:00';

    // Compute total hours & minutes from checkIn and checkOut
    let totalHours = 8.0;
    let totalMinutes = 480;

    if (checkIn && checkOut) {
      try {
        const [inH, inM] = checkIn.split(':').map(Number);
        const [outH, outM] = checkOut.split(':').map(Number);
        const diff = (outH * 60 + outM) - (inH * 60 + inM);
        if (diff > 0) {
          totalMinutes = diff;
          totalHours = parseFloat((diff / 60).toFixed(2));
        }
      } catch (_) {
        // Fallback to 8 hours
      }
    }

    if (targetStatus === 'half_day' && totalHours > 4.5) {
      totalHours = 4.0;
      totalMinutes = 240;
    }

    const remarksText = admin_remarks
      ? `Regularized by ${approver?.name || 'HR'}: ${admin_remarks} (Reason: ${request.reason})`
      : `Regularized by ${approver?.name || 'HR'} (Reason: ${request.reason})`;

    // Check if AttendanceRecord already exists for this date & employee
    let record = await AttendanceRecord.findOne({
      where: {
        employee_id: request.employee_id,
        date: request.date,
      },
    });

    if (record) {
      await record.update({
        status: targetStatus,
        check_in_time: checkIn,
        check_out_time: checkOut,
        total_hours: totalHours,
        total_minutes: totalMinutes,
        check_in_method: 'regularized',
        is_regularized: true,
        marked_by_id: approverId,
        remarks: remarksText,
      });
    } else {
      record = await AttendanceRecord.create({
        employee_id: request.employee_id,
        date: request.date,
        status: targetStatus,
        check_in_time: checkIn,
        check_out_time: checkOut,
        total_hours: totalHours,
        total_minutes: totalMinutes,
        check_in_method: 'regularized',
        is_regularized: true,
        marked_by_id: approverId,
        remarks: remarksText,
      });
    }

    // Update the request status
    await request.update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date(),
      admin_remarks: admin_remarks || null,
      attendance_record_id: record.id,
    });

    // Sync monthly attendance aggregate so payroll & attendance grid reflect the approved regularisation
    try {
      await attendanceService._updateMonthlyAttendance(request.employee_id, request.date);
    } catch (syncErr) {
      logger.warn(`Failed to auto-sync MonthlyAttendance after regularisation: ${syncErr.message}`);
    }

    // Send success notification to employee
    try {
      await Notification.create({
        employee_id: request.employee_id,
        title: 'Regularisation Request Approved! ✅',
        message: `Your regularisation request for ${request.date} has been approved as ${targetStatus.toUpperCase()} by ${approver?.name || 'HR'}.`,
        type: 'success',
        category: 'attendance',
        action_url: '/attendance',
      });
    } catch (notifErr) {
      logger.warn('Failed to send approval notification:', notifErr.message);
    }

    logger.info(`Regularisation request #${requestId} approved by approver ${approverId} as ${targetStatus}`);
    return request;
  }
}

module.exports = new RegularizationService();
