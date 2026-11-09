const attendanceService = require('../services/attendance.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class AttendanceController {
  async punchIn(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { latitude, longitude, is_outdoor, is_field_duty, remarks, reason, check_in_method } = req.body;
      const result = await attendanceService.punchIn(employeeId, latitude, longitude, {
        is_outdoor,
        is_field_duty,
        remarks,
        reason,
        check_in_method,
      });
      return success(res, 'Punch in successful', result, 200);
    } catch (err) {
      logger.error(`Punch in error: ${err.message}`);
      return next(err);
    }
  }

  async punchOut(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { latitude, longitude, is_outdoor, is_field_duty, remarks, reason, check_in_method } = req.body;
      const result = await attendanceService.punchOut(employeeId, latitude, longitude, {
        is_outdoor,
        is_field_duty,
        remarks,
        reason,
        check_in_method,
      });
      return success(res, 'Punch out successful', result, 200);
    } catch (err) {
      logger.error(`Punch out error: ${err.message}`);
      return next(err);
    }
  }

  async getTodayStatus(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const result = await attendanceService.getTodayStatus(employeeId);
      return success(res, 'Today status fetched', result, 200);
    } catch (err) {
      logger.error(`Get today status error: ${err.message}`);
      return next(err);
    }
  }

  async getMonthlyAttendance(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { month, year } = req.query;
      const result = await attendanceService.getMonthlyAttendance(employeeId, month, year);
      return success(res, 'Monthly attendance fetched', result, 200);
    } catch (err) {
      logger.error(`Get monthly attendance error: ${err.message}`);
      return next(err);
    }
  }

  async getAttendanceHistory(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { page, limit } = req.query;
      const result = await attendanceService.getAttendanceHistory(employeeId, page, limit);
      return paginated(res, 'Attendance history fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get attendance history error: ${err.message}`);
      return next(err);
    }
  }

  async getEmployeeAttendance(req, res, next) {
    try {
      const { employeeId } = req.params;
      const { month, year } = req.query;
      const result = await attendanceService.getMonthlyAttendance(employeeId, month, year);
      return success(res, 'Employee attendance fetched', result, 200);
    } catch (err) {
      logger.error(`Get employee attendance error: ${err.message}`);
      return next(err);
    }
  }

  async getTeamAttendance(req, res, next) {
    try {
      const managerId = req.employee.id;
      const { date } = req.query;
      const result = await attendanceService.getTeamAttendance(managerId, date);
      return success(res, 'Team attendance fetched', result, 200);
    } catch (err) {
      logger.error(`Get team attendance error: ${err.message}`);
      return next(err);
    }
  }

  async overrideAttendance(req, res, next) {
    try {
      const { id } = req.params;
      const overrideData = req.body;
      const result = await attendanceService.overrideAttendance(id, overrideData, req.employee.id);
      return success(res, 'Attendance overridden successfully', result, 200);
    } catch (err) {
      logger.error(`Override attendance error: ${err.message}`);
      return next(err);
    }
  }

  // Admin: Get live attendance for all employees
  async getLiveAttendance(req, res, next) {
    try {
      const { office_id, company_id, search, status, page, limit, department } = req.query;
      const result = await attendanceService.getLiveAttendance({ office_id, company_id, search, status, page, limit, department });
      return success(res, 'Live attendance fetched', result, 200);
    } catch (err) {
      logger.error(`Get live attendance error: ${err.message}`);
      return next(err);
    }
  }

  // Admin: Get all attendance history
  async getAllAttendanceHistory(req, res, next) {
    try {
      const { page, limit, from, to, office_id, company_id, search, department } = req.query;
      const result = await attendanceService.getAllAttendanceHistory({ page, limit, from, to, office_id, company_id, search, department });
      return success(res, 'Attendance history fetched', result, 200);
    } catch (err) {
      logger.error(`Get all attendance history error: ${err.message}`);
      return next(err);
    }
  }

  // Admin: Get monthly attendance grid for all employees
  async getAllMonthlyAttendance(req, res, next) {
    try {
      const { month, year, office_id, company_id, search, department, cycle_type, cycle } = req.query;
      const activeCycle = cycle_type || cycle || 'payroll';
      const result = await attendanceService.getAllMonthlyAttendance({ month, year, office_id, company_id, search, department, cycle_type: activeCycle });
      return success(res, 'Monthly attendance grid fetched', result, 200);
    } catch (err) {
      logger.error(`Get all monthly attendance error: ${err.message}`);
      return next(err);
    }
  }

  // Admin: Manual attendance entry / Authorized marking on employee's behalf
  async manualEntry(req, res, next) {
    try {
      const adminId = req.employee.id;
      const {
        employeeId,
        date,
        status,
        reason,
        is_outdoor,
        is_weekly_off_worked,
        weekly_off_compensation,
        check_in_time,
        check_out_time,
      } = req.body;
      const result = await attendanceService.manualEntry(adminId, {
        employeeId,
        date,
        status,
        reason,
        is_outdoor,
        is_weekly_off_worked,
        weekly_off_compensation,
        check_in_time,
        check_out_time,
      });
      return success(res, 'Manual attendance entry recorded successfully', result, 200);
    } catch (err) {
      logger.error(`Manual entry error: ${err.message}`);
      return next(err);
    }
  }

  // Admin/HR: Configure employee weekly-off schedule (fixed or rotational) (Req 2.5 C)
  async updateWeeklyOffConfig(req, res, next) {
    try {
      const adminId = req.employee.id;
      const { employeeId, weekly_off_days, rotational_weekly_off, weekly_off_type } = req.body;
      const result = await attendanceService.updateWeeklyOffConfig(adminId, {
        employeeId,
        weekly_off_days,
        rotational_weekly_off,
        weekly_off_type,
      });
      return success(res, 'Weekly off schedule updated successfully', result, 200);
    } catch (err) {
      logger.error(`Update weekly off config error: ${err.message}`);
      return next(err);
    }
  }

  // ── Tour management ──

  // Admin/HR: Mark an employee on tour
  async markTour(req, res, next) {
    try {
      const adminId = req.employee.id;
      const { employeeId, title, startDate, endDate, description, fromLocation, toLocation } = req.body;
      const result = await attendanceService.markTour(adminId, {
        employeeId, title, startDate, endDate, description, fromLocation, toLocation,
      });
      return success(res, result.message || 'Tour marked successfully', result, 201);
    } catch (err) {
      logger.error(`Mark tour error: ${err.message}`);
      return next(err);
    }
  }

  // Admin/HR: Get all tours (paginated + filters)
  async getAllTours(req, res, next) {
    try {
      const { page, limit, search, status, employee_id, from, to, office_id, company_id } = req.query;
      const result = await attendanceService.getAllTours({
        page, limit, search, status, employee_id, from, to, office_id, company_id,
      });
      return paginated(res, 'Tours fetched', result.tours, result.pagination, 200);
    } catch (err) {
      logger.error(`Get all tours error: ${err.message}`);
      return next(err);
    }
  }

  // Admin/HR: Get a single tour by ID
  async getTourById(req, res, next) {
    try {
      const { id } = req.params;
      const result = await attendanceService.getTourById(id);
      return success(res, 'Tour details fetched', result, 200);
    } catch (err) {
      logger.error(`Get tour by id error: ${err.message}`);
      return next(err);
    }
  }

  // Admin/HR: Cancel a tour
  async cancelTour(req, res, next) {
    try {
      const adminId = req.employee.id;
      const { id } = req.params;
      const { reason } = req.body;
      const result = await attendanceService.cancelTour(id, adminId, reason);
      return success(res, result.message || 'Tour cancelled successfully', result, 200);
    } catch (err) {
      logger.error(`Cancel tour error: ${err.message}`);
      return next(err);
    }
  }

  // Employee: Check if currently on tour (mobile app)
  async getTourStatus(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const result = await attendanceService.getEmployeeTourStatus(employeeId);
      return success(res, 'Tour status fetched', result, 200);
    } catch (err) {
      logger.error(`Get tour status error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new AttendanceController();