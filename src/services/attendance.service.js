const { AttendanceRecord, MonthlyAttendance, Employee, Office, sequelize, Holiday, SystemSetting, Tour } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op, literal } = require('sequelize');
const logger = require('../utils/logger');
const { GEO_FENCE } = require('../utils/constants');
const env = require('../config/env');
const { getHolidaysInMonth, countWorkingDaysInMonth, isHolidayDate } = require('../utils/payrollHelper');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

// Grace period (in minutes) allowed after shift start before marking attendance as "late".
// e.g. 10 minutes means an employee punching in up to 10:10 for a 10:00 shift is still "present".
const LATE_GRACE_MINUTES = parseInt(process.env.LATE_GRACE_MINUTES || '10', 10) || 0;

/**
 * Returns configurable late threshold minutes (e.g. 60 min / 1 hr) from SystemSetting or env.
 */
async function _getLateThresholdMinutes() {
  try {
    const setting = await SystemSetting.findByPk('late_threshold_minutes');
    if (setting && setting.value) {
      const val = parseInt(setting.value, 10);
      if (!isNaN(val)) return val;
    }
  } catch (e) {
    logger.error(`Failed to read late threshold setting: ${e.message}`);
  }
  return parseInt(process.env.LATE_GRACE_MINUTES || '60', 10) || 60;
}

/**
 * Returns the set of JS day-of-week numbers that are weekends based on the
 * stored weekend policy.
 * 'sunday_only'      → [0]          (Sunday)
 * 'saturday_sunday'  → [0, 6]       (Sunday, Saturday)
 */
async function _getWeekendDays() {
  try {
    const setting = await SystemSetting.findByPk('weekend_policy');
    const policy = setting ? setting.value : 'sunday_only';
    return policy === 'saturday_sunday' ? [0, 6] : [0];
  } catch (e) {
    logger.error(`Failed to read weekend policy, defaulting to sunday_only: ${e.message}`);
    return [0];
  }
}

/**
 * Helper to get the employee's weekly-off day numbers (0 for Sun, 1 for Mon, ..., 6 for Sat).
 * Supports rotational and fixed weekly-off days (Req 2.5 C).
 */
function getEmployeeWeeklyOffDays(emp, fallbackWeekendDays = [0]) {
  if (!emp || !emp.weekly_off_days) {
    return fallbackWeekendDays;
  }
  let offs = emp.weekly_off_days;
  if (typeof offs === 'string') {
    try {
      offs = JSON.parse(offs);
    } catch (e) {
      offs = offs.split(',').map(s => s.trim());
    }
  }
  if (!Array.isArray(offs) || offs.length === 0) {
    return fallbackWeekendDays;
  }
  const dayMap = {
    'sunday': 0, 'sun': 0, '0': 0,
    'monday': 1, 'mon': 1, '1': 1,
    'tuesday': 2, 'tue': 2, '2': 2,
    'wednesday': 3, 'wed': 3, '3': 3,
    'thursday': 4, 'thu': 4, '4': 4,
    'friday': 5, 'fri': 5, '5': 5,
    'saturday': 6, 'sat': 6, '6': 6,
  };
  const resolved = offs
    .map(d => {
      if (typeof d === 'number') return d;
      return dayMap[String(d).toLowerCase().trim()];
    })
    .filter(n => n !== undefined);
  return resolved.length > 0 ? resolved : fallbackWeekendDays;
}

/**
 * Checks whether a given YYYY-MM-DD date string falls on an active public holiday.
 * Returns the holiday name if matched, otherwise null.
 */
async function _getHolidayName(dateStr) {
  const holiday = await Holiday.findOne({
    where: {
      is_active: true,
      start_date: { [Op.lte]: dateStr },
      end_date: { [Op.gte]: dateStr },
    },
  });
  return holiday ? holiday.name : null;
}

/**
 * Returns the current local Date object for the target timezone.
 */
function getLocalDate(date = new Date(), timeZone = TIMEZONE) {
  return new Date(date.toLocaleString('en-US', { timeZone }));
}

/**
 * Returns the current local date string (YYYY-MM-DD) for the target timezone.
 */
function getLocalDateString(date = new Date(), timeZone = TIMEZONE) {
  const local = getLocalDate(date, timeZone);
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns the minutes since midnight for a Date in the target timezone.
 */
function getLocalMinutesFromMidnight(date, timeZone = TIMEZONE) {
  const localStr = date.toLocaleString('en-US', { timeZone, hour12: false });
  const timePart = localStr.includes(',') ? localStr.split(',')[1].trim() : localStr.split(' ')[1].trim();
  const parts = timePart.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  return hours * 60 + minutes;
}

/**
 * Parses a "HH:MM:SS" string to minutes since midnight.
 */
function timeStringToMinutes(timeStr, defaultMins) {
  if (!timeStr) return defaultMins;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) || 0;
  if (isNaN(hours) || isNaN(minutes)) return defaultMins;
  return hours * 60 + minutes;
}

/**
 * Generates timezone offset suffix (e.g. "+05:30") for building ISO timestamps.
 */
function getTzOffsetSuffix(date, timeZone = TIMEZONE) {
  try {
    const localStr = date.toLocaleString('en-US', { timeZone, timeZoneName: 'longOffset' });
    const gmtIndex = localStr.indexOf('GMT');
    if (gmtIndex !== -1) {
      const offsetStr = localStr.substring(gmtIndex + 3).trim();
      const sign = offsetStr[0];
      const rest = offsetStr.substring(1);
      let hours = 0;
      let minutes = 0;
      if (rest.includes(':')) {
        const parts = rest.split(':');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10) || 0;
      } else if (rest.length >= 3) {
        hours = parseInt(rest.substring(0, rest.length - 2), 10);
        minutes = parseInt(rest.substring(rest.length - 2), 10) || 0;
      } else {
        hours = parseInt(rest, 10);
      }
      return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  } catch (e) {
    logger.error(`Error calculating timezone offset: ${e.message}`);
  }
  return '+05:30';
}

/**
 * Creates a Date object representing the specified time on the given date in the target timezone.
 */
function createTzDate(dateStr, timeStr, timeZone = TIMEZONE) {
  const tempDate = new Date(`${dateStr}T12:00:00`);
  const offset = getTzOffsetSuffix(tempDate, timeZone);
  return new Date(`${dateStr}T${timeStr}${offset}`);
}

/**
 * Format a TIME value (string "HH:MM:SS" or Date object) to "HH:MM AM/PM" display format in target local timezone.
 * Returns '---' for falsy values.
 */
function _formatTime(time, timeZone = TIMEZONE) {
  if (!time) return '---';
  let hours, minutes;
  if (typeof time === 'string') {
    const parts = time.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else if (time instanceof Date) {
    const localStr = time.toLocaleString('en-US', { timeZone, hour12: false });
    const timePart = localStr.includes(',') ? localStr.split(',')[1].trim() : localStr.split(' ')[1].trim();
    const parts = timePart.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    return '---';
  }
  if (isNaN(hours) || isNaN(minutes)) return '---';
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/**
 * Helper to convert a database TIME string (assumed to be in UTC) to the target timezone (IST) and format it.
 */
function _formatRecordTime(time, dateStr, timeZone = TIMEZONE) {
  if (!time) return '---';
  if (time instanceof Date) {
    return _formatTime(time, timeZone);
  }
  try {
    const utcDate = new Date(`${dateStr}T${time}Z`);
    return _formatTime(utcDate, timeZone);
  } catch (e) {
    logger.error(`Error formatting record time: ${e.message}`);
    return '---';
  }
}

class AttendanceService {
  async punchIn(employeeId, latitude, longitude, outdoorData = {}) {
    const today = new Date();
    const dateStr = getLocalDateString(today);

    // ── Block punch-in on holidays ──
    const holidayName = await _getHolidayName(dateStr);
    if (holidayName) {
      throw new AppError(`Today is a public holiday: ${holidayName}. Punch in is not allowed.`, 403);
    }

    // ── Block punch-in on weekends ──
    const weekendDays = await _getWeekendDays();
    const localToday = getLocalDate(today);
    if (weekendDays.includes(localToday.getDay())) {
      throw new AppError('Today is a weekend off. Punch in is not allowed.', 403);
    }

    // Check if already punched in today
    const existingRecord = await AttendanceRecord.findOne({
      where: { employee_id: employeeId, date: dateStr },
    });

    if (existingRecord && existingRecord.check_in_time) {
      throw new AppError('Already punched in today', 400);
    }

    // Get employee profile with their company association
    const employee = await Employee.findByPk(employeeId, { include: ['office'] });
    if (!employee) {
      throw new AppError('Employee profile not found', 400);
    }

    const isOutdoor = Boolean(
      outdoorData.is_outdoor ||
      outdoorData.is_field_duty ||
      outdoorData.check_in_method === 'outdoor'
    );

    // Get all active offices for this company
    const offices = await Office.findAll({
      where: { company_id: employee.company_id, is_active: true }
    });

    let matchingOffice = null;
    let distance = 0;

    if (isOutdoor) {
      matchingOffice = offices.find(o => o.id === employee.office_id) || offices[0] || null;
      distance = 0;
      logger.info(`[OUTDOOR PUNCH-IN] Employee ${employee.emp_code} (${employeeId}) marked outdoor attendance.`);
    } else {
      let minDistance = null;
      let primaryDistance = null;

      for (const office of offices) {
        const dist = this._calculateDistance(
          latitude, longitude,
          office.latitude, office.longitude
        );

        if (employee.office_id === office.id) {
          primaryDistance = dist;
          if (dist <= office.radius_meters) {
            matchingOffice = office;
            minDistance = dist;
            break;
          }
        }

        if (dist <= office.radius_meters) {
          if (matchingOffice === null || dist < minDistance) {
            matchingOffice = office;
            minDistance = dist;
          }
        }
      }

      if (!matchingOffice) {
        const primaryLocName = employee.office?.name || 'Primary Office';
        const detailMsg = primaryDistance !== null 
          ? `outside ${primaryLocName} by ${Math.round(primaryDistance - (employee.office?.radius_meters || 200))}m`
          : 'outside any company office geofence';
        throw new AppError(`You are outside all registered office perimeters (${detailMsg}).`, 403);
      }

      distance = minDistance;
    }

    // Determine status and late arrival using shift_start_time (default 10:00 AM = 600 mins)
    const localCheckInMins = getLocalMinutesFromMidnight(today);
    const shiftStartMins = timeStringToMinutes(employee.shift_start_time, 600);
    const shiftEndMins = timeStringToMinutes(employee.shift_end_time, 1140);

    // Enforce allowed punch-in window (2 hours before shift start until shift end)
    const allowedStart = shiftStartMins - 120;
    const allowedEnd = shiftEndMins;

    let normStart = allowedStart;
    if (normStart < 0) {
      normStart += 1440;
    }

    let isWithinWindow = false;
    if (allowedEnd < normStart) {
      isWithinWindow = (localCheckInMins >= normStart) || (localCheckInMins <= allowedEnd);
    } else {
      isWithinWindow = (localCheckInMins >= normStart) && (localCheckInMins <= allowedEnd);
    }

    if (env.NODE_ENV && env.NODE_ENV.trim() === 'development') {
      isWithinWindow = true;
    }

    if (!isWithinWindow) {
      throw new AppError(`Punch in is only allowed during shift hours (from ${_formatTime(employee.shift_start_time || '10:00:00')} to ${_formatTime(employee.shift_end_time || '19:00:00')} with 2 hours early buffer).`, 403);
    }

    // Determine late minutes (respect configurable late threshold buffer - default 60 mins)
    const lateThreshold = await _getLateThresholdMinutes();
    let lateByMinutes = 0;
    if (shiftEndMins < shiftStartMins) {
      if (localCheckInMins >= shiftStartMins) {
        lateByMinutes = localCheckInMins - shiftStartMins;
      } else if (localCheckInMins <= shiftEndMins) {
        lateByMinutes = (1440 - shiftStartMins) + localCheckInMins;
      }
    } else {
      if (localCheckInMins > shiftStartMins) {
        lateByMinutes = localCheckInMins - shiftStartMins;
      }
    }
    const isLate = lateByMinutes > lateThreshold;
    if (!isLate) {
      lateByMinutes = 0;
    }
    const status = isLate ? 'late' : 'present';

    // Check if check-in is on Sunday or employee's configured weekly-off day (Req 2.5 D)
    const weekendDays = await _getWeekendDays();
    const empWeeklyOffs = getEmployeeWeeklyOffDays(employee, weekendDays);
    const localDayOfWeek = today.getDay();
    const isWeeklyOffDay = empWeeklyOffs.includes(localDayOfWeek);
    const holidayName = await _getHolidayName(dateStr);
    const isWeeklyOffWorked = isWeeklyOffDay || Boolean(holidayName);
    const weeklyOffComp = isWeeklyOffWorked ? 'additional_payable_day' : 'none';

    const checkInMethod = isOutdoor ? 'outdoor' : (outdoorData.check_in_method || 'web');
    const defaultRemark = isWeeklyOffWorked
      ? `Worked on weekly off / Sunday (${weeklyOffComp})`
      : (isOutdoor ? 'Outdoor / Field duty check-in' : null);
    const remarks = outdoorData.remarks || outdoorData.reason || defaultRemark;

    const record = await AttendanceRecord.create({
      employee_id: employeeId,
      date: dateStr,
      status,
      check_in_time: today,
      check_in_distance: distance,
      late_by_minutes: lateByMinutes,
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      check_in_method: checkInMethod,
      is_outdoor: isOutdoor,
      is_weekly_off_worked: isWeeklyOffWorked,
      weekly_off_compensation: weeklyOffComp,
      remarks,
      punch_in_office_id: matchingOffice ? matchingOffice.id : null,
    });

    logger.info(`Employee ${employee.emp_code} punched in (${checkInMethod}) at ${today.toISOString()}`);

    return {
      id: record.id,
      date: record.date,
      check_in_time: record.check_in_time,
      status: record.status,
      late_by_minutes: record.late_by_minutes,
      distance: Math.round(distance),
      is_outdoor: record.is_outdoor,
      remarks: record.remarks,
    };
  }

  async punchOut(employeeId, latitude, longitude, outdoorData = {}) {
    const today = new Date();
    const dateStr = getLocalDateString(today);

    const record = await AttendanceRecord.findOne({
      where: { employee_id: employeeId, date: dateStr },
    });

    if (!record || !record.check_in_time) {
      throw new AppError('You have not punched in today', 400);
    }

    if (record.check_out_time) {
      throw new AppError('Already punched out today', 400);
    }

    const employee = await Employee.findByPk(employeeId, { include: ['office'] });
    if (!employee) {
      throw new AppError('Employee profile not found', 400);
    }

    const isOutdoor = Boolean(
      record.is_outdoor ||
      record.check_in_method === 'outdoor' ||
      outdoorData.is_outdoor ||
      outdoorData.is_field_duty ||
      outdoorData.check_in_method === 'outdoor'
    );

    const offices = await Office.findAll({
      where: { company_id: employee.company_id, is_active: true }
    });

    let matchingOffice = null;
    let distance = 0;

    if (isOutdoor) {
      matchingOffice = offices.find(o => o.id === employee.office_id) || offices[0] || null;
      distance = 0;
    } else {
      let minDistance = null;
      let primaryDistance = null;

      for (const office of offices) {
        const dist = this._calculateDistance(
          latitude, longitude,
          office.latitude, office.longitude
        );

        if (employee.office_id === office.id) {
          primaryDistance = dist;
          if (dist <= office.radius_meters) {
            matchingOffice = office;
            minDistance = dist;
            break;
          }
        }

        if (dist <= office.radius_meters) {
          if (matchingOffice === null || dist < minDistance) {
            matchingOffice = office;
            minDistance = dist;
          }
        }
      }

      if (!matchingOffice) {
        const primaryLocName = employee.office?.name || 'Primary Office';
        const detailMsg = primaryDistance !== null 
          ? `outside ${primaryLocName} by ${Math.round(primaryDistance - (employee.office?.radius_meters || 200))}m`
          : 'outside any company office geofence';
        throw new AppError(`You are outside all registered office perimeters (${detailMsg}).`, 403);
      }

      distance = minDistance;
    }

    let checkInTime = null;
    if (typeof record.check_in_time === 'string') {
      checkInTime = new Date(`${record.date}T${record.check_in_time}Z`);
      if (checkInTime > today) {
        checkInTime.setUTCDate(checkInTime.getUTCDate() - 1);
      }
    } else if (record.check_in_time instanceof Date) {
      checkInTime = record.check_in_time;
    } else {
      checkInTime = new Date(record.check_in_time);
    }
    const totalMinutes = Math.floor((today - checkInTime) / 60000);
    const totalHours = totalMinutes > 0 ? (totalMinutes / 60) : 0;

    // Check for early exit and overtime using shift_end_time
    const localCheckOutMins = getLocalMinutesFromMidnight(today);
    const shiftEndMins = timeStringToMinutes(employee ? employee.shift_end_time : null, 1140);
    const shiftStartMins = timeStringToMinutes(employee ? employee.shift_start_time : null, 600);

    let isEarlyExit = false;
    let earlyExitMinutes = 0;
    let overtimeMinutes = 0;

    if (shiftEndMins < shiftStartMins) {
      if (localCheckOutMins >= shiftStartMins) {
        isEarlyExit = true;
        earlyExitMinutes = (1440 - localCheckOutMins) + shiftEndMins;
      } else if (localCheckOutMins < shiftEndMins) {
        isEarlyExit = true;
        earlyExitMinutes = shiftEndMins - localCheckOutMins;
      } else {
        overtimeMinutes = localCheckOutMins - shiftEndMins;
      }
    } else {
      if (localCheckOutMins < shiftEndMins) {
        isEarlyExit = true;
        earlyExitMinutes = shiftEndMins - localCheckOutMins;
      } else {
        overtimeMinutes = localCheckOutMins - shiftEndMins;
      }
    }

    let status = record.status;
    if (totalMinutes < 240) {
      status = 'half_day';
    }

    let updatedRemarks = record.remarks;
    if (outdoorData.remarks) {
      updatedRemarks = updatedRemarks ? `${updatedRemarks} | ${outdoorData.remarks}` : outdoorData.remarks;
    }

    await record.update({
      check_out_time: today,
      check_out_distance: distance,
      total_hours: totalHours,
      total_minutes: totalMinutes,
      early_exit_minutes: earlyExitMinutes,
      status,
      check_out_latitude: latitude,
      check_out_longitude: longitude,
      overtime_minutes: overtimeMinutes,
      punch_out_office_id: matchingOffice ? matchingOffice.id : null,
      remarks: updatedRemarks,
      is_outdoor: isOutdoor,
    });

    // Update monthly attendance
    await this._updateMonthlyAttendance(employeeId, dateStr);

    logger.info(`Employee ${employee ? employee.emp_code : employeeId} punched out at ${today.toISOString()} — OT: ${overtimeMinutes}min`);

    return {
      id: record.id,
      date: record.date,
      check_in_time: record.check_in_time,
      check_out_time: record.check_out_time,
      total_hours: totalHours,
      total_minutes: totalMinutes,
      status,
      early_exit_minutes: earlyExitMinutes,
      is_outdoor: record.is_outdoor,
      remarks: record.remarks,
    };
  }

  async getTodayStatus(employeeId) {
    const today = new Date();
    const dateStr = getLocalDateString(today);
    const record = await AttendanceRecord.findOne({
      where: { employee_id: employeeId, date: dateStr },
    });

    const employee = await Employee.findByPk(employeeId);

    // ── Check tour blocking ──
    // If the employee is on an active tour today, punching is disabled.
    let isOnTour = false;
    let tourInfo = null;
    const activeTour = await Tour.findOne({
      where: {
        employee_id: employeeId,
        status: 'active',
        start_date: { [Op.lte]: dateStr },
        end_date: { [Op.gte]: dateStr },
      },
    });
    if (activeTour) {
      isOnTour = true;
      tourInfo = {
        id: activeTour.id,
        tour_code: activeTour.tour_code,
        title: activeTour.title,
        from_location: activeTour.from_location,
        to_location: activeTour.to_location,
        start_date: activeTour.start_date,
        end_date: activeTour.end_date,
      };
    }

    // ── Check holiday / weekend blocking ──
    let disabledReason = null;
    if (isOnTour) {
      disabledReason = `You are on a company tour (${activeTour.title}). No need to punch in.`;
    } else {
      const holidayName = await _getHolidayName(dateStr);
      if (holidayName) {
        disabledReason = `Today is a public holiday: ${holidayName}`;
      } else {
        const weekendDays = await _getWeekendDays();
        const localToday = getLocalDate(today);
        if (weekendDays.includes(localToday.getDay())) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          disabledReason = `Today is ${dayNames[localToday.getDay()]} — a weekend off`;
        }
      }
    }

    // Shift calculations (default 10:00 AM - 6:00 PM)
    const localMins = getLocalMinutesFromMidnight(today);
    const shiftStartMins = timeStringToMinutes(employee ? employee.shift_start_time : null, 600); // 10:00 AM = 600 mins
    const shiftEndMins = timeStringToMinutes(employee ? employee.shift_end_time : null, 1140); // 7:00 PM = 1140 mins

    const allowedStart = shiftStartMins - 120; // 2 hour early buffer
    const allowedEnd = shiftEndMins;

    let normStart = allowedStart;
    if (normStart < 0) {
      normStart += 1440;
    }

    let isWithinWindow = false;
    if (allowedEnd < normStart) {
      // Midnight-crossing shift
      isWithinWindow = (localMins >= normStart) || (localMins <= allowedEnd);
    } else {
      // Normal shift
      isWithinWindow = (localMins >= normStart) && (localMins <= allowedEnd);
    }

    if (env.NODE_ENV && env.NODE_ENV.trim() === 'development') {
      isWithinWindow = true;
    }

    const isPunchedIn = !!(record && record.check_in_time && !record.check_out_time);
    const isPunchedOut = !!(record && record.check_out_time);

    // If holiday/weekend, both punch in and out are disabled
    const isPunchInAllowed = disabledReason ? false : isWithinWindow;
    const isPunchOutAllowed = disabledReason ? false : true;

    return {
      date: dateStr,
      isPunchedIn,
      isPunchedOut,
      isPunchInAllowed,
      isPunchOutAllowed,
      disabledReason,
      isOnTour,
      tour: tourInfo,
      record: record || null,
    };
  }

  async getMonthlyAttendance(employeeId, month, year) {
    const currentYear = year || new Date().getFullYear();
    const currentMonth = month || new Date().getMonth() + 1;

    const monthlyRecord = await MonthlyAttendance.findOne({
      where: {
        employee_id: employeeId,
        month: currentMonth,
        year: currentYear,
      },
    });

    let prevMonthYear = currentYear;
    let prevMonth = currentMonth - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevMonthYear = currentYear - 1;
    }

    const startDateStr = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-26`;
    const endDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-25`;

    const dailyRecords = await AttendanceRecord.findAll({
      where: {
        employee_id: employeeId,
        date: {
          [Op.between]: [startDateStr, endDateStr],
        },
      },
      order: [['date', 'ASC']],
    });

    // Dynamically calculate and fill in missing records for past days in the cycle
    const recordMap = new Map(dailyRecords.map(r => [r.date, r]));
    const weekendDays = await _getWeekendDays();
    const holidays = await getHolidaysInMonth(currentYear, currentMonth);

    const { LeaveRequest } = require('../models');
    const cycleLeaves = await LeaveRequest.findAll({
      where: {
        employee_id: employeeId,
        status: { [Op.in]: ['approved', 'pending'] },
        from_date: { [Op.lte]: endDateStr },
        to_date: { [Op.gte]: startDateStr }
      }
    });

    const getLeaveForDate = (dateStr) => {
      return cycleLeaves.find(l => dateStr >= l.from_date && dateStr <= l.to_date);
    };

    const localTodayStr = getLocalDateString(new Date());
    const endLimitDate = new Date(endDateStr) < new Date(localTodayStr) ? new Date(endDateStr) : new Date(localTodayStr);

    const filledRecords = [];
    let dObj = new Date(startDateStr);

    while (dObj <= endLimitDate) {
      const yyyy = dObj.getFullYear();
      const mm = String(dObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dObj.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const dayOfWeek = dObj.getDay();

      const isHoliday = isHolidayDate(dateStr, holidays);
      const isWeekendDay = weekendDays.includes(dayOfWeek);
      const activeLeave = getLeaveForDate(dateStr);

      const existing = recordMap.get(dateStr);
      if (existing) {
        filledRecords.push(existing);
      } else {
        let status = 'absent';
        let remarks = 'No punch-in recorded';

        if (isWeekendDay) {
          status = 'weekend';
          remarks = 'Weekly Off';
        } else if (isHoliday) {
          status = 'holiday';
          const h = holidays.find(h => dateStr >= h.start_date && dateStr <= h.end_date);
          remarks = h ? `Public Holiday: ${h.name}` : 'Public Holiday';
        } else if (activeLeave) {
          if (activeLeave.status === 'pending') {
            // Req 10: Pending/unapproved leave does not automatically reduce salary
            status = 'leave';
            remarks = 'Pending Leave Request (Protected from salary deduction)';
          } else if (activeLeave.payroll_treatment === 'unpaid' || (!activeLeave.is_paid && activeLeave.payroll_treatment !== 'paid')) {
            // Explicit Admin-designated Loss of Pay (LWP)
            status = 'absent';
            remarks = 'Approved Leave (Loss of Pay / Unpaid)';
          } else {
            // Approved Paid / Adjusted Leave
            status = 'holiday';
            remarks = `Approved Leave (${(activeLeave.leave_type || 'EL').toUpperCase()}) - Paid`;
          }
        }

        filledRecords.push({
          id: `virtual-${dateStr}`,
          employee_id: employeeId,
          date: dateStr,
          status,
          remarks,
          check_in_time: null,
          check_out_time: null,
          total_hours: 0,
          total_minutes: 0,
        });
      }

      dObj.setDate(dObj.getDate() + 1);
    }

    // Keep any future records (e.g. tour days in the future)
    dailyRecords.forEach(r => {
      if (new Date(r.date) > endLimitDate && !filledRecords.some(fr => fr.date === r.date)) {
        filledRecords.push(r);
      }
    });

    filledRecords.sort((a, b) => a.date.localeCompare(b.date));

    return {
      monthly: monthlyRecord,
      daily: filledRecords,
    };
  }

  async getAttendanceHistory(employeeId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const { rows, count } = await AttendanceRecord.findAndCountAll({
      where: { employee_id: employeeId },
      order: [['date', 'DESC']],
      limit,
      offset,
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async getTeamAttendance(managerId, date) {
    const dateStr = date || getLocalDateString(new Date());

    // Get employees under this manager's department
    const manager = await Employee.findByPk(managerId);
    if (!manager) {
      throw new AppError('Manager not found', 404);
    }

    const teamMembers = await Employee.findAll({
      where: { department: manager.department, status: 'active' },
      attributes: ['id', 'emp_code', 'name', 'designation', 'profile_image'],
    });

    const teamIds = teamMembers.map(e => e.id);

    const attendanceRecords = await AttendanceRecord.findAll({
      where: { employee_id: { [Op.in]: teamIds }, date: dateStr },
    });

    // Map attendance to team members
    const result = teamMembers.map(member => {
      const record = attendanceRecords.find(r => r.employee_id === member.id);
      return {
        ...member.toJSON(),
        attendance: record || null,
      };
    });

    return result;
  }

  async overrideAttendance(recordId, overrideData, adminId) {
    const record = await AttendanceRecord.findByPk(recordId);
    if (!record) {
      throw new AppError('Attendance record not found', 404);
    }

    await record.update({
      ...overrideData,
      remarks: `Overridden by admin ID ${adminId}: ${overrideData.remarks || 'No reason provided'}`,
    });

    // Recalculate monthly attendance
    await this._updateMonthlyAttendance(record.employee_id, record.date);

    logger.info(`Attendance record ${recordId} overridden by admin ${adminId}`);
    return record;
  }

  // Admin: Get today's attendance for all employees (Live Status tab)
  async getLiveAttendance({ office_id, company_id, search, status: statusFilter, page = 1, limit = 8, department } = {}) {
    const today = getLocalDateString(new Date());

    // Check if today is an active public holiday
    const activeHoliday = await Holiday.findOne({
      where: {
        is_active: true,
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today }
      }
    });

    const weekendDays = await _getWeekendDays();
    const isWeekend = weekendDays.includes(getLocalDate(new Date()).getDay());

    // Build employee where clause
    const empWhere = { status: 'active', role: { [Op.ne]: 'admin' } };
    if (search) {
      empWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }
    if (office_id) empWhere.office_id = office_id;
    if (company_id) empWhere.company_id = company_id;
    if (department) empWhere.department = department;

    const { rows: employees, count: totalEmployees } = await Employee.findAndCountAll({
      where: empWhere,
      include: ['office', 'company'],
      attributes: ['id', 'emp_code', 'name', 'designation', 'profile_image', 'department'],
    });

    const empIds = employees.map(e => e.id);
    const todayRecords = await AttendanceRecord.findAll({
      where: { employee_id: { [Op.in]: empIds }, date: today },
      include: [
        { model: Office, as: 'punchInOffice', attributes: ['id', 'name'] },
        { model: Employee, as: 'markedBy', attributes: ['id', 'name', 'emp_code'] }
      ]
    });

    // Device name mapping for frontend display
    const deviceLabel = (method) => {
      const map = { biometric: 'Biometric', gps: 'GPS/Mobile', manual: 'Manual', qr_code: 'QR Code', web: 'Web App', outdoor: 'Outdoor Duty' };
      return map[method] || 'Web App';
    };

    // Build stats
    const recordMap = new Map(todayRecords.map(r => [r.employee_id, r]));
    let presentCount = 0, absentCount = 0, lateCount = 0;

    const rows = employees.map(emp => {
      const record = recordMap.get(emp.id);
      let status = 'Absent';
      let punchIn = null, punchOut = null, hours = '0h', overtime = '---', distance = '---', lateFine = 0;
      let device = '---', remarks = '', checkInLat = null, checkInLon = null;

      if (record) {
        if (record.status === 'present') { status = 'Present'; presentCount++; }
        else if (record.status === 'late') { status = 'Late'; lateCount++; presentCount++; }
        else if (record.status === 'half_day') { status = 'Half Day'; presentCount++; }
        else if (record.status === 'tour') { status = 'Tour'; presentCount++; }
        else { status = 'Absent'; absentCount++; }

        punchIn = record.check_in_time;
        punchOut = record.check_out_time;
        if (record.total_hours) hours = `${Math.floor(record.total_hours)}h ${Math.round((record.total_hours % 1) * 60)}m`;
        if (record.late_by_minutes > 0) lateFine = record.late_by_minutes * 2;
        if (record.check_in_distance) distance = `${Math.round(record.check_in_distance)}m`;
        device = deviceLabel(record.check_in_method);
        remarks = record.remarks || '';
        if (record.overtime_minutes > 0) {
          const otH = Math.floor(record.overtime_minutes / 60);
          const otM = record.overtime_minutes % 60;
          overtime = otH > 0 ? `${otH}h ${otM}m` : `${otM}m`;
        }
        checkInLat = record.check_in_latitude;
        checkInLon = record.check_in_longitude;
      } else {
        if (activeHoliday) {
          status = 'Holiday';
        } else if (isWeekend) {
          status = 'Weekend';
        } else {
          status = 'Absent';
          absentCount++;
        }
      }

      let locationName = emp.office?.name || '---';
      if (record && record.punchInOffice && record.punchInOffice.id !== emp.office_id) {
        locationName = `${emp.office?.name || '---'} (Work from ${record.punchInOffice.name})`;
      }

      return {
        id: emp.emp_code,
        employeeNumericId: emp.id,
        name: emp.name,
        designation: emp.designation || '',
        department: emp.department || '---',
        status,
        punchIn: punchIn ? _formatRecordTime(punchIn, today) : '---',
        punchOut: punchOut ? _formatRecordTime(punchOut, today) : '---',
        location: locationName,
        company: emp.company?.name || '---',
        distance,
        device,
        isOutdoor: Boolean(record?.is_outdoor || record?.check_in_method === 'outdoor'),
        markedBy: record?.markedBy ? { id: record.markedBy.id, name: record.markedBy.name, empCode: record.markedBy.emp_code } : null,
        shift: 'General',
        hours: record?.check_out_time ? hours : (record?.check_in_time ? 'Ongoing' : '0h'),
        overtime,
        remarks: record?.remarks || null,
        lateFine,
        checkInLatitude: checkInLat,
        checkInLongitude: checkInLon,
        employee_id: emp.id,
        record_id: record?.id || null,
        // Office geo-fence data for map circle overlay
        officeLatitude: emp.office?.latitude || null,
        officeLongitude: emp.office?.longitude || null,
        officeRadius: emp.office?.radius_meters || 200,
      };
    });

    // Apply status filter
    const filteredRows = statusFilter && statusFilter !== 'All'
      ? rows.filter(r => r.status === statusFilter)
      : rows;

    // Paginate
    const offset = (page - 1) * limit;
    const paginatedRows = filteredRows.slice(offset, offset + limit);

    return {
      stats: {
        total: totalEmployees,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
      },
      rows: paginatedRows,
      pagination: {
        page,
        limit,
        total: filteredRows.length,
        totalPages: Math.ceil(filteredRows.length / limit),
      },
    };
  }

  // Admin: Get all attendance history (History tab)
  async getAllAttendanceHistory({ page = 1, limit = 20, from, to, office_id, company_id, search, department } = {}) {
    const where = {};
    if (from && to) {
      where.date = { [Op.between]: [from, to] };
    } else if (from) {
      where.date = { [Op.gte]: from };
    } else if (to) {
      where.date = { [Op.lte]: to };
    }

    const empWhere = { status: 'active', role: { [Op.ne]: 'admin' } };
    if (search) {
      empWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }
    if (office_id) empWhere.office_id = office_id;
    if (company_id) empWhere.company_id = company_id;
    if (department) empWhere.department = department;

    // Device name mapping for frontend display
    const deviceLabel = (method) => {
      const map = { biometric: 'Biometric', gps: 'GPS/Mobile', manual: 'Manual', qr_code: 'QR Code', web: 'Web App' };
      return map[method] || 'Web App';
    };

    // Get employees first
    const allEmployees = await Employee.findAll({ where: empWhere, include: ['office', 'company'], attributes: ['id', 'emp_code', 'name', 'department'] });
    const empIds = allEmployees.map(e => e.id);
    const empMap = new Map(allEmployees.map(e => [e.id, e]));
    const officeMap = new Map(allEmployees.map(e => [e.id, e.office]));

    if (empIds.length === 0) {
      return { rows: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 } };
    }

    where.employee_id = { [Op.in]: empIds };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await AttendanceRecord.findAndCountAll({
      where,
      include: [
        { model: Office, as: 'punchInOffice', attributes: ['id', 'name'] }
      ],
      order: [['date', 'DESC'], ['check_in_time', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    const historyRows = rows.map(r => {
      const emp = empMap.get(r.employee_id);
      const office = officeMap.get(r.employee_id);
      let status = 'Present';
      if (r.status === 'absent') status = 'Absent';
      else if (r.status === 'late') status = 'Late';
      else if (r.status === 'half_day') status = 'Half Day';
      else if (r.status === 'tour') status = 'Tour';
      else if (r.status === 'weekend') status = 'Weekend';
      else if (r.status === 'holiday') status = 'Holiday';

      // Format overtime
      let overtimeStr = '---';
      if (r.overtime_minutes > 0) {
        const otH = Math.floor(r.overtime_minutes / 60);
        const otM = r.overtime_minutes % 60;
        overtimeStr = otH > 0 ? `${otH}h ${otM}m` : `${otM}m`;
      }

      let hubName = office?.name || '---';
      if (r.punchInOffice && r.punchInOffice.id !== office?.id) {
        hubName = `${office?.name || '---'} (Work from ${r.punchInOffice.name})`;
      }

      return {
        date: r.date,
        name: emp?.name || 'Unknown',
        id: emp?.emp_code || '-',
        hub: hubName,
        company: emp?.company?.name || '---',
        department: emp?.department || '---',
        shift: 'General',
        hours: r.total_hours ? `${Math.floor(r.total_hours)}h ${Math.round((r.total_hours % 1) * 60)}m` : '---',
        ot: overtimeStr,
        status,
        in: r.check_in_time ? _formatRecordTime(r.check_in_time, r.date) : '---',
        out: r.check_out_time ? _formatRecordTime(r.check_out_time, r.date) : '---',
        device: deviceLabel(r.check_in_method),
        fine: r.late_by_minutes > 0 ? r.late_by_minutes * 2 : 0,
        dist: r.check_in_distance ? `${Math.round(r.check_in_distance)}m` : '---',
        record_id: r.id,
        remarks: r.remarks || null,
      };
    });

    // Compute stats from ALL matching records (not just paginated slice)
    const allRecords = await AttendanceRecord.findAll({
      where: { employee_id: { [Op.in]: empIds }, ...(from && to ? { date: { [Op.between]: [from, to] } } : from ? { date: { [Op.gte]: from } } : to ? { date: { [Op.lte]: to } } : {}) },
      attributes: ['status', 'total_hours', 'total_minutes', 'late_by_minutes', 'overtime_minutes'],
    });

    const totalRecords = allRecords.length;
    const presentRecords = allRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    const lateRecords = allRecords.filter(r => r.status === 'late').length;
    const absentRecords = allRecords.filter(r => r.status === 'absent').length;
    const totalWorkHours = allRecords.reduce((sum, r) => sum + (r.total_hours || 0), 0);
    const totalOvertimeMinutes = allRecords.reduce((sum, r) => sum + (r.overtime_minutes || 0), 0);
    const avgAttendance = totalRecords > 0 ? Math.round((presentRecords / totalRecords) * 100) : 0;

    return {
      rows: historyRows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / parseInt(limit)) },
      stats: {
        avgAttendance,
        totalRecords,
        presentRecords,
        lateRecords,
        absentRecords,
        totalWorkHours: Math.round(totalWorkHours),
        totalOvertimeHours: Math.round(totalOvertimeMinutes / 60),
        activeEmployees: empIds.length,
      },
    };
  }

  // Admin: Get monthly attendance grid for all employees
  async getAllMonthlyAttendance({ month, year, office_id, company_id, search, department, cycle_type = 'payroll' } = {}) {
    const localToday = getLocalDate(new Date());
    const currentMonth = month ? parseInt(month) : localToday.getMonth() + 1;
    const currentYear = year ? parseInt(year) : localToday.getFullYear();

    const empWhere = { status: 'active', role: { [Op.ne]: 'admin' } };
    if (search) {
      empWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }
    if (office_id) empWhere.office_id = office_id;
    if (company_id) empWhere.company_id = company_id;
    if (department) empWhere.department = department;

    const employees = await Employee.findAll({
      where: empWhere,
      include: ['office', 'company'],
      attributes: ['id', 'emp_code', 'name', 'designation', 'fixed_gross', 'department', 'weekly_off_days', 'rotational_weekly_off', 'weekly_off_type', 'shift_start_time', 'shift_end_time'],
    });

    const empIds = employees.map(e => e.id);

    // Support both 'payroll' cycle (26th to 25th) and standard 'calendar' cycle (1st to month end)
    let startDateStr, endDateStr, startDate, endDate, daysInCycle;

    if (cycle_type === 'calendar') {
      const lastDay = new Date(currentYear, currentMonth, 0).getDate(); // 28, 29, 30, or 31
      startDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      endDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      startDate = new Date(currentYear, currentMonth - 1, 1);
      endDate = new Date(currentYear, currentMonth - 1, lastDay);
      daysInCycle = lastDay;
    } else {
      let prevMonthYear = currentYear;
      let prevMonth = currentMonth - 1;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevMonthYear = currentYear - 1;
      }
      startDateStr = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-26`;
      endDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-25`;
      startDate = new Date(prevMonthYear, prevMonth - 1, 26);
      endDate = new Date(currentYear, currentMonth - 1, 25);
      const oneDayMs = 24 * 60 * 60 * 1000;
      daysInCycle = Math.round((endDate - startDate) / oneDayMs) + 1;
    }

    // Get all daily records for these employees in the cycle
    const dailyRecords = await AttendanceRecord.findAll({
      where: {
        employee_id: { [Op.in]: empIds },
        date: {
          [Op.between]: [startDateStr, endDateStr],
        },
      },
      order: [['date', 'ASC']],
    });

    // Get active public holidays
    const holidaysList = await Holiday.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { start_date: { [Op.between]: [startDateStr, endDateStr] } },
          { end_date: { [Op.between]: [startDateStr, endDateStr] } },
          {
            [Op.and]: [
              { start_date: { [Op.lte]: startDateStr } },
              { end_date: { [Op.gte]: endDateStr } }
            ]
          }
        ]
      }
    });

    // Get all leaves (approved and pending) for employees during this period (Req 10)
    const { LeaveRequest, LeaveBalance } = require('../models');
    const allLeaves = await LeaveRequest.findAll({
      where: {
        employee_id: { [Op.in]: empIds },
        status: { [Op.in]: ['approved', 'pending'] },
        from_date: { [Op.lte]: endDateStr },
        to_date: { [Op.gte]: startDateStr },
      },
    });

    const leaveMap = new Map();
    allLeaves.forEach(l => {
      if (!leaveMap.has(l.employee_id)) leaveMap.set(l.employee_id, []);
      leaveMap.get(l.employee_id).push(l);
    });

    // Fetch leave balances for all employees to calculate remaining leave balance (Req 2.5 A)
    const leaveBalances = await LeaveBalance.findAll({
      where: {
        employee_id: { [Op.in]: empIds },
        year: currentYear,
      },
    });
    const balanceMap = new Map();
    leaveBalances.forEach(b => balanceMap.set(b.employee_id, b));

    // Get global weekend policy for grid rendering fallback
    const weekendDaysGrid = await _getWeekendDays();

    // Generate days metadata array with day name, number, holiday and weekend status
    const daysMetadata = [];
    let metaDayObj = new Date(startDate);
    while (metaDayObj <= endDate) {
      const yyyy = metaDayObj.getFullYear();
      const mm = String(metaDayObj.getMonth() + 1).padStart(2, '0');
      const dd = String(metaDayObj.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const dayOfWeek = metaDayObj.getDay();

      const hol = holidaysList.find(h => dateStr >= h.start_date && dateStr <= h.end_date);
      const isWeekendDay = weekendDaysGrid.includes(dayOfWeek);
      const dayShort = metaDayObj.toLocaleDateString('en-US', { weekday: 'short' });

      daysMetadata.push({
        date: dateStr,
        day: metaDayObj.getDate(),
        day_of_week: dayShort,
        label: `${String(metaDayObj.getDate()).padStart(2, '0')} ${dayShort}`,
        is_weekend: isWeekendDay,
        is_holiday: Boolean(hol),
        holiday_name: hol ? hol.name : null,
      });

      metaDayObj.setDate(metaDayObj.getDate() + 1);
    }

    // Map records by employee and date
    const recordMap = new Map();
    dailyRecords.forEach(r => {
      if (!recordMap.has(r.employee_id)) recordMap.set(r.employee_id, new Map());
      recordMap.get(r.employee_id).set(r.date, r);
    });

    const rows = employees.map(emp => {
      const empRecords = recordMap.get(emp.id) || new Map();
      const empLeaves = leaveMap.get(emp.id) || [];
      const salary = emp.fixed_gross || 0;
      const empWeeklyOffs = getEmployeeWeeklyOffDays(emp, weekendDaysGrid);

      let grid = '';
      const gridDetails = [];
      let presentCount = 0;
      let halfDayCount = 0;
      let absentCount = 0;
      let woffCount = 0;
      let paidLeaveCount = 0;
      let holidayCount = 0;
      let tourCount = 0;
      let weeklyOffWorkedCount = 0;
      let weeklyOffWorkedCompDays = 0;

      let dObj = new Date(startDate);
      while (dObj <= endDate) {
        const yyyy = dObj.getFullYear();
        const mm = String(dObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dObj.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const dayOfWeek = dObj.getDay();

        const isHoliday = holidaysList.some(h => dateStr >= h.start_date && dateStr <= h.end_date);
        const isWeekendDay = empWeeklyOffs.includes(dayOfWeek);
        const activeLeave = empLeaves.find(l => dateStr >= l.from_date && dateStr <= l.to_date);

        const record = empRecords.get(dateStr);
        let statusChar = '-';
        let displayCode = '-';
        let isWoWorked = false;
        let compensation = 'none';

        if (record) {
          isWoWorked = Boolean(record.is_weekly_off_worked);
          compensation = record.weekly_off_compensation || 'none';

          // Auto-detect weekly off working if on employee's off day and marked present/half_day
          if (isWoWorked || (isWeekendDay && (record.status === 'present' || record.status === 'half_day' || (record.check_in_time && record.status !== 'weekend')))) {
            isWoWorked = true;
            compensation = compensation !== 'none' ? compensation : 'additional_payable_day';
            weeklyOffWorkedCount++;
            if (compensation === 'additional_payable_day') {
              weeklyOffWorkedCompDays++;
            }
            if (record.status === 'half_day') {
              grid += 'P';
              statusChar = 'P';
              displayCode = 'WO';
              halfDayCount++;
            } else {
              grid += 'P';
              statusChar = 'P';
              displayCode = 'WO';
              presentCount++;
            }
          } else if (record.status === 'present' || record.status === 'late') {
            grid += 'P';
            statusChar = 'P';
            displayCode = 'P';
            presentCount++;
          } else if (record.status === 'half_day') {
            grid += 'P';
            statusChar = 'P';
            displayCode = 'HD';
            halfDayCount++;
          } else if (record.status === 'tour') {
            grid += 'T';
            statusChar = 'T';
            displayCode = 'T';
            tourCount++;
          } else if (record.status === 'absent') {
            grid += 'A';
            statusChar = 'A';
            displayCode = 'A';
            absentCount++;
          } else if (record.status === 'holiday') {
            grid += 'H';
            statusChar = 'H';
            displayCode = 'H';
            holidayCount++;
          } else if (record.status === 'weekend') {
            grid += 'W';
            statusChar = 'W';
            displayCode = 'W';
            woffCount++;
          } else if (record.status === 'leave' || record.status === 'on_leave') {
            grid += 'L';
            statusChar = 'L';
            displayCode = 'L';
            paidLeaveCount++;
          } else {
            grid += 'P';
            statusChar = 'P';
            displayCode = 'P';
            presentCount++;
          }
        } else {
          const isFutureDate = dObj > localToday;
          if (isFutureDate) {
            grid += '-';
            statusChar = '-';
            displayCode = '-';
          } else if (activeLeave) {
            if (activeLeave.status === 'pending') {
              // Req 10: Pending/unapproved leave does not automatically reduce salary
              grid += 'L';
              statusChar = 'L';
              displayCode = 'L';
              paidLeaveCount++;
            } else if (activeLeave.payroll_treatment === 'unpaid' || (!activeLeave.is_paid && activeLeave.payroll_treatment !== 'paid')) {
              // Explicit Admin-designated Loss of Pay (LWP)
              grid += 'A';
              statusChar = 'A';
              displayCode = 'A';
              absentCount++;
            } else {
              // Approved Paid / Adjusted Leave
              grid += 'L';
              statusChar = 'L';
              displayCode = 'L';
              paidLeaveCount++;
            }
          } else if (isHoliday) {
            grid += 'H';
            statusChar = 'H';
            displayCode = 'H';
            holidayCount++;
          } else if (isWeekendDay) {
            grid += 'W';
            statusChar = 'W';
            displayCode = 'W';
            woffCount++;
          } else {
            grid += 'A';
            statusChar = 'A';
            displayCode = 'A';
            absentCount++;
          }
        }

        gridDetails.push({
          date: dateStr,
          day: dObj.getDate(),
          status: record ? record.status : (activeLeave ? (activeLeave.status === 'pending' ? 'pending_leave' : (activeLeave.payroll_treatment === 'unpaid' ? 'lwp' : 'paid_leave')) : (isHoliday ? 'holiday' : (isWeekendDay ? 'weekend' : (dObj > localToday ? 'future' : 'absent')))),
          display_code: displayCode,
          is_weekend: isWeekendDay,
          is_weekly_off_worked: isWoWorked,
          compensation,
          is_holiday: isHoliday,
          is_leave: Boolean(activeLeave),
          is_lwp: displayCode === 'A',
          is_outdoor: record ? Boolean(record.is_outdoor) : false,
          check_in_time: record ? record.check_in_time : null,
          check_out_time: record ? record.check_out_time : null,
          total_hours: record ? record.total_hours : null,
          remarks: record ? record.remarks : null,
        });

        dObj.setDate(dObj.getDate() + 1);
      }

      // Compute remaining leave balance from LeaveBalance model (Req 2.6: PL + EL + CL + Comp-Off)
      const bal = balanceMap.get(emp.id);
      const plAlloc = bal ? Number(bal.pl_allocated != null ? bal.pl_allocated : 12) : 12;
      const plCarr = bal ? Number(bal.pl_carried_forward || 0) : 0;
      const plUsed = bal ? Number(bal.pl_used || 0) : 0;
      const plRem = Math.max(0, (plAlloc + plCarr) - plUsed);

      const elAlloc = bal ? Number(bal.el_allocated != null ? bal.el_allocated : 12) : 12;
      const elCarr = bal ? Number(bal.el_carried_forward || 0) : 0;
      const elUsed = bal ? Number(bal.el_used || 0) : 0;
      const elRem = Math.max(0, (elAlloc + elCarr) - elUsed);

      const clAlloc = bal ? Number(bal.cl_allocated != null ? bal.cl_allocated : 12) : 12;
      const clUsed = bal ? Number(bal.cl_used || 0) : 0;
      const clRem = Math.max(0, clAlloc - clUsed);

      const compOffBal = bal ? Number(bal.comp_off_balance || 0) : 0;
      const remainingBalance = Math.round((plRem + elRem + clRem + compOffBal) * 100) / 100;

      const totalLeavesTaken = paidLeaveCount + absentCount;
      const payableDays = presentCount + (halfDayCount * 0.5) + woffCount + holidayCount + tourCount + paidLeaveCount + weeklyOffWorkedCompDays;

      return {
        id: emp.emp_code,
        employee_id: emp.id,
        name: emp.name,
        role: emp.designation || 'Employee',
        department: emp.department || '---',
        hub: emp.office?.name || '---',
        company: emp.company?.name || '---',
        salary,
        present: presentCount,
        half_days: halfDayCount,
        woff: woffCount,
        leave: paidLeaveCount,
        paid_leaves_taken: paidLeaveCount,
        holiday: holidayCount,
        tour: tourCount,
        absent: absentCount,
        lwp_days: absentCount,
        total_leaves_taken: totalLeavesTaken,
        remaining_leave_balance: remainingBalance,
        weekly_off_worked_days: weeklyOffWorkedCount,
        weekly_off_days: emp.weekly_off_days || ['Sunday'],
        rotational_weekly_off: Boolean(emp.rotational_weekly_off),
        weekly_off_type: emp.weekly_off_type || 'fixed',
        shift_start_time: emp.shift_start_time,
        shift_end_time: emp.shift_end_time,
        grid,
        grid_details: gridDetails,
        muster_days: daysInCycle,
        total_days: daysInCycle,
        present_days: presentCount,
        payable_days: payableDays,
        holidays: holidayCount,
        week_offs: woffCount,
        tour_days: tourCount,
        leave_days: paidLeaveCount,
      };
    });

    const summary = {
      total_staff: rows.length,
      total_payable_days: rows.reduce((s, r) => s + (r.payable_days || 0), 0),
      total_lwp_days: rows.reduce((s, r) => s + (r.lwp_days || 0), 0),
      total_leaves_taken: rows.reduce((s, r) => s + (r.total_leaves_taken || 0), 0),
      total_paid_leaves_taken: rows.reduce((s, r) => s + (r.paid_leaves_taken || 0), 0),
      total_remaining_leave_balance: rows.reduce((s, r) => s + (r.remaining_leave_balance || 0), 0),
      total_weekly_off_worked: rows.reduce((s, r) => s + (r.weekly_off_worked_days || 0), 0),
      muster_days: daysInCycle,
    };

    return {
      month: currentMonth,
      year: currentYear,
      cycle_type,
      daysInMonth: daysInCycle,
      metadata: {
        cycle_type,
        month: currentMonth,
        year: currentYear,
        month_name: new Date(currentYear, currentMonth - 1, 1).toLocaleString('en-US', { month: 'long' }),
        start_date: startDateStr,
        end_date: endDateStr,
        days_in_cycle: daysInCycle,
        days_metadata: daysMetadata,
        summary,
      },
      rows,
    };
  }

  // Admin: Manual attendance entry / Authorized marking on employee's behalf (Req 5.2, 2.5 B, 2.5 D)
  async manualEntry(adminId, {
    employeeId,
    date,
    status,
    reason,
    is_outdoor,
    is_weekly_off_worked,
    weekly_off_compensation,
    check_in_time,
    check_out_time,
  }) {
    let emp = null;
    if (typeof employeeId === 'number' || /^\d+$/.test(employeeId)) {
      emp = await Employee.findByPk(employeeId);
    }
    if (!emp) {
      emp = await Employee.findOne({ where: { emp_code: employeeId } });
    }
    if (!emp) {
      throw new AppError(`Employee ${employeeId} not found`, 404);
    }

    // Handle both ISO string (from raw request) and Date object (from Joi convert)
    const dateStr = date instanceof Date
      ? date.toISOString().split('T')[0]
      : (date || getLocalDateString(new Date()));
    const statusMap = {
      'Present': 'present',
      'Absent': 'absent',
      'Half Day': 'half_day',
      'Late': 'late',
      'Weekly Off Worked': 'present',
      'present': 'present',
      'absent': 'absent',
      'half_day': 'half_day',
      'late': 'late',
      'weekly_off_worked': 'present',
    };
    const recordStatus = statusMap[status] || (status ? status.toLowerCase() : 'present');

    const isWoWorked = Boolean(is_weekly_off_worked) || status === 'Weekly Off Worked' || status === 'weekly_off_worked';
    const woComp = isWoWorked ? (weekly_off_compensation || 'additional_payable_day') : 'none';

    // Credit Comp-Off to LeaveBalance if that compensation was chosen (Req 2.5 D)
    if (isWoWorked && woComp === 'comp_off') {
      try {
        const { LeaveBalance } = require('../models');
        const entryYear = new Date(dateStr).getFullYear();
        const [lb] = await LeaveBalance.findOrCreate({
          where: { employee_id: emp.id, year: entryYear },
          defaults: { employee_id: emp.id, year: entryYear, available: 24, cl_allocated: 12, el_allocated: 12, comp_off_balance: 0 },
        });
        await lb.increment('comp_off_balance', { by: 1 });
        logger.info(`Credited +1 comp-off to employee ${emp.emp_code} for working on weekly off (${dateStr})`);
      } catch (lbErr) {
        logger.warn(`Could not increment comp_off_balance: ${lbErr.message}`);
      }
    }

    // Build timestamps for Present / Half Day entries
    let checkInTime = null;
    let checkOutTime = null;
    let totalHours = null;
    let totalMinutes = 0;

    const shiftStartTimeStr = check_in_time || emp.shift_start_time || '10:00:00';
    const shiftEndTimeStr = check_out_time || emp.shift_end_time || '19:00:00';

    if (recordStatus === 'present' || recordStatus === 'late') {
      const inStr = shiftStartTimeStr.length === 5 ? `${shiftStartTimeStr}:00` : shiftStartTimeStr;
      const outStr = shiftEndTimeStr.length === 5 ? `${shiftEndTimeStr}:00` : shiftEndTimeStr;
      checkInTime = createTzDate(dateStr, inStr);
      checkOutTime = createTzDate(dateStr, outStr);
      
      const startMins = timeStringToMinutes(shiftStartTimeStr, 600);
      const endMins = timeStringToMinutes(shiftEndTimeStr, 1140);
      totalMinutes = endMins - startMins;
      totalHours = totalMinutes / 60;
    } else if (recordStatus === 'half_day') {
      const inStr = shiftStartTimeStr.length === 5 ? `${shiftStartTimeStr}:00` : shiftStartTimeStr;
      checkInTime = createTzDate(dateStr, inStr);
      
      const startMins = timeStringToMinutes(shiftStartTimeStr, 600);
      const endMins = timeStringToMinutes(shiftEndTimeStr, 1140);
      const halfDuration = Math.round((endMins - startMins) / 2);
      const halfEndMins = startMins + halfDuration;
      
      const halfEndHours = Math.floor(halfEndMins / 60);
      const halfEndMinsRemainder = halfEndMins % 60;
      const halfEndTimeStr = `${String(halfEndHours).padStart(2, '0')}:${String(halfEndMinsRemainder).padStart(2, '0')}:00`;
      
      checkOutTime = createTzDate(dateStr, halfEndTimeStr);
      totalMinutes = halfDuration;
      totalHours = totalMinutes / 60;
    }

    const outdoorFlag = Boolean(is_outdoor);
    const method = outdoorFlag ? 'outdoor' : 'manual';
    const remarkText = `Marked by authorized user ${adminId}: ${reason || (isWoWorked ? `Weekly off worked (${woComp})` : outdoorFlag ? 'Outdoor duty' : 'Manual adjustment')}`;

    // Check if record already exists for this date
    let record = await AttendanceRecord.findOne({ where: { employee_id: emp.id, date: dateStr } });

    if (record) {
      await record.update({
        status: recordStatus,
        check_in_time: checkInTime || record.check_in_time,
        check_out_time: checkOutTime || record.check_out_time,
        total_hours: totalHours !== null ? totalHours : record.total_hours,
        total_minutes: totalMinutes || record.total_minutes,
        check_in_method: method,
        is_outdoor: outdoorFlag,
        is_weekly_off_worked: isWoWorked,
        weekly_off_compensation: woComp,
        marked_by_id: adminId,
        remarks: remarkText,
      });
    } else {
      record = await AttendanceRecord.create({
        employee_id: emp.id,
        date: dateStr,
        status: recordStatus,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        total_hours: totalHours,
        total_minutes: totalMinutes,
        late_by_minutes: recordStatus === 'late' ? 30 : 0,
        early_exit_minutes: 0,
        overtime_minutes: 0,
        check_in_method: method,
        is_outdoor: outdoorFlag,
        is_weekly_off_worked: isWoWorked,
        weekly_off_compensation: woComp,
        marked_by_id: adminId,
        remarks: remarkText,
      });
    }

    // Recalculate monthly attendance summary
    await this._updateMonthlyAttendance(emp.id, dateStr);

    // Sync with payroll ledger if payroll entry already generated for this month
    try {
      const { PayrollEntry, PayrollCycle } = require('../models');
      const [punchYr, punchMo] = dateStr.split('-').map(Number);
      const cycle = await PayrollCycle.findOne({
        where: { year: punchYr, month: punchMo },
      });
      if (cycle) {
        const payrollEntry = await PayrollEntry.findOne({
          where: { payroll_cycle_id: cycle.id, employee_id: emp.id },
        });
        if (payrollEntry) {
          const updatedMonthly = await MonthlyAttendance.findOne({
            where: { employee_id: emp.id, month: punchMo, year: punchYr },
          });
          if (updatedMonthly) {
            const newAbsent = Number(updatedMonthly.absent_days) + Number(updatedMonthly.half_days) * 0.5;
            await payrollEntry.update({ absent_days: newAbsent });
            logger.info(`Synced attendance adjustment into PayrollEntry for employee ${emp.emp_code} (absent: ${newAbsent})`);
          }
        }
      }
    } catch (syncErr) {
      logger.warn(`Failed to auto-sync payroll entry on attendance adjust: ${syncErr.message}`);
    }

    logger.info(`Admin ${adminId} authorized attendance entry for ${emp.emp_code} on ${dateStr} as ${recordStatus} (weeklyOffWorked: ${isWoWorked})`);
    return record;
  }

  // Admin/HR: Configure employee weekly-off schedule (fixed or rotational) (Req 2.5 C)
  async updateWeeklyOffConfig(adminId, { employeeId, weekly_off_days, rotational_weekly_off, weekly_off_type }) {
    let emp = null;
    if (typeof employeeId === 'number' || /^\d+$/.test(employeeId)) {
      emp = await Employee.findByPk(employeeId);
    }
    if (!emp) {
      emp = await Employee.findOne({ where: { emp_code: employeeId } });
    }
    if (!emp) {
      throw new AppError(`Employee ${employeeId} not found`, 404);
    }

    let formattedDays = weekly_off_days;
    if (typeof formattedDays === 'string') {
      try {
        formattedDays = JSON.parse(formattedDays);
      } catch (e) {
        formattedDays = formattedDays.split(',').map(s => s.trim());
      }
    }
    if (!Array.isArray(formattedDays)) {
      formattedDays = [formattedDays];
    }

    const isRotational = rotational_weekly_off !== undefined
      ? Boolean(rotational_weekly_off)
      : (weekly_off_type === 'rotational');
    const offType = weekly_off_type || (isRotational ? 'rotational' : 'fixed');

    await emp.update({
      weekly_off_days: formattedDays,
      rotational_weekly_off: isRotational,
      weekly_off_type: offType,
    });

    const todayStr = getLocalDateString(new Date());
    await this._updateMonthlyAttendance(emp.id, todayStr);

    logger.info(`Admin ${adminId} configured weekly off for ${emp.emp_code}: ${JSON.stringify(formattedDays)} (${offType})`);

    return {
      employee_id: emp.id,
      emp_code: emp.emp_code,
      name: emp.name,
      weekly_off_days: formattedDays,
      rotational_weekly_off: isRotational,
      weekly_off_type: offType,
    };
  }

  // Private: Calculate distance between two coordinates (Haversine formula)
  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = this._toRad(lat2 - lat1);
    const dLon = this._toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _toRad(deg) {
    return deg * (Math.PI / 180);
  }

  // Private: Update monthly attendance summary (Req 2.5 A, C, D)
  async _updateMonthlyAttendance(employeeId, dateStr) {
    const [punchYear, punchMonth, punchDay] = dateStr.split('-').map(Number);
    
    let year = punchYear;
    let month = punchMonth;
    if (punchDay >= 26) {
      month = punchMonth + 1;
      if (month > 12) {
        month = 1;
        year = punchYear + 1;
      }
    }
    
    let prevMonthYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevMonthYear = year - 1;
    }
    
    const cycleStart = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-26`;
    const cycleEnd = `${year}-${String(month).padStart(2, '0')}-25`;

    const records = await AttendanceRecord.findAll({
      where: {
        employee_id: employeeId,
        date: {
          [Op.between]: [ cycleStart, cycleEnd ],
        },
      },
    });

    // Load employee weekly-off configuration (fixed or rotational) (Req 2.5 C)
    const emp = await Employee.findByPk(employeeId, {
      attributes: ['id', 'emp_code', 'weekly_off_days', 'rotational_weekly_off', 'weekly_off_type'],
    });

    // ── Fetch dynamic weekend policy & holidays ──
    const weekendDays = await _getWeekendDays();
    const empWeeklyOffs = getEmployeeWeeklyOffDays(emp, weekendDays);
    const holidays = await getHolidaysInMonth(year, month);

    // Fetch leaves overlapping the cycle (both approved and pending) (Req 10)
    const { LeaveRequest, LeaveBalance } = require('../models');
    const cycleLeaves = await LeaveRequest.findAll({
      where: {
        employee_id: employeeId,
        status: { [Op.in]: ['approved', 'pending'] },
        from_date: { [Op.lte]: cycleEnd },
        to_date: { [Op.gte]: cycleStart }
      }
    });

    // Explicit Admin-designated unpaid leaves (LWP)
    const isUnpaidLeaveDate = (dStr) => {
      return cycleLeaves.some(l =>
        l.status === 'approved' &&
        (l.payroll_treatment === 'unpaid' || (!l.is_paid && l.payroll_treatment !== 'paid')) &&
        dStr >= l.from_date && dStr <= l.to_date
      );
    };

    // Protected leaves: pending leaves (Req 10: unapproved leave does not reduce salary) OR approved paid/adjusted leaves
    const isProtectedLeaveDate = (dStr) => {
      return cycleLeaves.some(l => {
        if (dStr < l.from_date || dStr > l.to_date) return false;
        if (l.status === 'pending') return true; // Req 10: Pending unapproved leaves do NOT reduce salary
        if (l.status === 'approved' && l.payroll_treatment !== 'unpaid') return true; // Paid or carry forward
        return false;
      });
    };

    // Calculate daily metrics by looping over every day in the cycle up to today
    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let tourDays = 0;
    let weekendDaysCount = 0;
    let holidayDaysCount = 0;
    let paidLeavesCount = 0;
    let weeklyOffWorkedCount = 0;
    let weeklyOffWorkedCompDays = 0;

    const recordMap = new Map(records.map(r => [r.date, r]));
    const localTodayStr = getLocalDateString(new Date());
    const endLimitDate = new Date(cycleEnd) < new Date(localTodayStr) ? new Date(cycleEnd) : new Date(localTodayStr);

    let dObj = new Date(cycleStart);
    while (dObj <= endLimitDate) {
      const yStr = dObj.getFullYear();
      const mStr = String(dObj.getMonth() + 1).padStart(2, '0');
      const dStr = String(dObj.getDate()).padStart(2, '0');
      const dateKey = `${yStr}-${mStr}-${dStr}`;
      const dayOfWeek = dObj.getDay();

      const isHoliday = isHolidayDate(dateKey, holidays);
      const isWeekendDay = empWeeklyOffs.includes(dayOfWeek);

      const r = recordMap.get(dateKey);
      if (r) {
        const isWoWorked = Boolean(r.is_weekly_off_worked);
        const woComp = r.weekly_off_compensation || 'none';

        if (isWoWorked || (isWeekendDay && (r.status === 'present' || r.status === 'half_day' || (r.check_in_time && r.status !== 'weekend')))) {
          weeklyOffWorkedCount++;
          if (woComp !== 'comp_off') {
            weeklyOffWorkedCompDays++;
          }
          if (r.status === 'half_day') halfDays++;
          else presentDays++;
        } else if (r.status === 'present') presentDays++;
        else if (r.status === 'late') lateDays++;
        else if (r.status === 'half_day') halfDays++;
        else if (r.status === 'tour') tourDays++;
        else if (r.status === 'absent') absentDays++;
        else if (r.status === 'weekend') weekendDaysCount++;
        else if (r.status === 'holiday') holidayDaysCount++;
        else if (r.status === 'leave' || r.status === 'on_leave') paidLeavesCount++;
        else presentDays++;
      } else {
        if (isWeekendDay) {
          weekendDaysCount++;
        } else if (isHoliday) {
          holidayDaysCount++;
        } else if (isProtectedLeaveDate(dateKey)) {
          // Protected from salary reduction (pending unapproved leave or approved paid leave)
          paidLeavesCount++;
        } else if (isUnpaidLeaveDate(dateKey)) {
          // Explicit Admin decision: unpaid leave (LWP)
          absentDays++;
        } else {
          // No record, no weekend, no holiday, no leave -> Unexplained Absent
          absentDays++;
        }
      }

      dObj.setDate(dObj.getDate() + 1);
    }

    // Keep stats for any future records that fell outside the limit
    records.forEach(r => {
      if (new Date(r.date) > endLimitDate) {
        if (r.status === 'present') presentDays++;
        else if (r.status === 'late') lateDays++;
        else if (r.status === 'half_day') halfDays++;
        else if (r.status === 'tour') tourDays++;
        else if (r.status === 'absent') absentDays++;
        else if (r.status === 'weekend') weekendDaysCount++;
        else if (r.status === 'holiday') holidayDaysCount++;
        else if (r.status === 'leave') paidLeavesCount++;
      }
    });

    // Calculate working days (excluding employee configured weekly offs AND holidays)
    const totalWorkingDays = countWorkingDaysInMonth(year, month, empWeeklyOffs, holidays);
    // Tour days are treated as paid/present for attendance percentage
    const attendancePercentage = totalWorkingDays > 0
      ? Math.round(((presentDays + lateDays + halfDays * 0.5 + tourDays) / totalWorkingDays) * 100)
      : 0;

    // Formula for Payable Days (Req 2.5 A & D)
    const payableDays = presentDays + (halfDays * 0.5) + weekendDaysCount + holidayDaysCount + paidLeavesCount + tourDays + weeklyOffWorkedCompDays;
    const totalLeavesTaken = paidLeavesCount + absentDays;

    // Fetch live LeaveBalance for this employee (Req 2.6: PL + EL + CL + Comp-Off)
    const lb = await LeaveBalance.findOne({ where: { employee_id: employeeId, year } });
    const plBal = lb ? Math.max(0, (Number(lb.pl_allocated != null ? lb.pl_allocated : 12) + Number(lb.pl_carried_forward || 0)) - Number(lb.pl_used || 0)) : 12;
    const elBal = lb ? Math.max(0, (Number(lb.el_allocated != null ? lb.el_allocated : 12) + Number(lb.el_carried_forward || 0)) - Number(lb.el_used || 0)) : 12;
    const clBal = lb ? Math.max(0, Number(lb.cl_allocated != null ? lb.cl_allocated : 12) - Number(lb.cl_used || 0)) : 12;
    const compOffBal = lb ? Number(lb.comp_off_balance || 0) : 0;
    const remainingLeaveBalance = Math.round((plBal + elBal + clBal + compOffBal) * 100) / 100;

    await MonthlyAttendance.upsert({
      employee_id: employeeId,
      month,
      year,
      present_days: presentDays,
      absent_days: absentDays,
      late_days: lateDays,
      half_days: halfDays,
      weekend_days: weekendDaysCount,
      holiday_days: holidayDaysCount,
      tour_days: tourDays,
      total_working_days: totalWorkingDays,
      attendance_percentage: attendancePercentage,
      payable_days: payableDays,
      lwp_days: absentDays,
      paid_leaves_taken: paidLeavesCount,
      total_leaves_taken: totalLeavesTaken,
      weekly_off_worked_days: weeklyOffWorkedCount,
      remaining_leave_balance: remainingLeaveBalance,
    });
  }
  }

  /**
   * Calculate working days in a month, respecting the dynamic weekend policy
   * AND active holidays.
   * @param {number} year
   * @param {number} month  1-indexed
   * @param {number[]} [weekendDays] - optional pre-fetched weekend days array
   * @param {Array} [holidays] - optional pre-fetched holidays array
   */
  async _getWorkingDaysInMonth(year, month, weekendDays, holidays) {
    const wDays = weekendDays || await _getWeekendDays();
    const hols = holidays || await getHolidaysInMonth(year, month);
    let count = 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month - 1, day);
      if (wDays.includes(d.getDay())) continue;

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isHolidayDate(dateStr, hols)) continue;

      count++;
    }
    return count;
  }

  /**
   * Generate a unique tour code like TOUR-2026-0001
   */
  async _generateTourCode() {
    const year = new Date().getFullYear();
    const prefix = `TOUR-${year}-`;
    const lastTour = await Tour.findOne({
      where: { tour_code: { [Op.like]: `${prefix}%` } },
      order: [['id', 'DESC']],
    });
    let nextNum = 1;
    if (lastTour && lastTour.tour_code) {
      const parts = lastTour.tour_code.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num)) nextNum = num + 1;
    }
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Mark an employee on tour for a date range.
   * Creates a Tour record + AttendanceRecord(status='tour') for each working day.
   * Tour days are treated as PAID (like present) — no salary deduction.
   */
  async markTour(adminId, { employeeId, title, startDate, endDate, description, fromLocation, toLocation }) {
    if (!employeeId || !title || !startDate || !endDate) {
      const err = new Error('employeeId, title, startDate and endDate are required');
      err.status = 400;
      throw err;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const err = new Error('Invalid date format');
      err.status = 400;
      throw err;
    }
    if (end < start) {
      const err = new Error('end_date cannot be before start_date');
      err.status = 400;
      throw err;
    }

    const employee = (typeof employeeId === 'number' || /^\d+$/.test(employeeId))
      ? await Employee.findByPk(employeeId)
      : await Employee.findOne({ where: { emp_code: employeeId } });
    if (!employee) {
      const err = new Error('Employee not found');
      err.status = 404;
      throw err;
    }
    const resolvedEmployeeId = employee.id;

    // Check for overlapping active tours
    const overlapping = await Tour.findOne({
      where: {
        employee_id: resolvedEmployeeId,
        status: 'active',
        [Op.or]: [
          { start_date: { [Op.between]: [startDate, endDate] } },
          { end_date: { [Op.between]: [startDate, endDate] } },
          { [Op.and]: [{ start_date: { [Op.lte]: startDate } }, { end_date: { [Op.gte]: endDate } }] },
        ],
      },
    });
    if (overlapping) {
      const err = new Error(`Employee already has an active tour (${overlapping.tour_code}) overlapping these dates`);
      err.status = 409;
      throw err;
    }

    const tourCode = await this._generateTourCode();

    const transaction = await sequelize.transaction();
    try {
      const tour = await Tour.create({
        tour_code: tourCode,
        employee_id: resolvedEmployeeId,
        title,
        description: description || null,
        from_location: fromLocation || null,
        to_location: toLocation || null,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        created_by: adminId,
      }, { transaction });

      // Create attendance records with status='tour' for each day in range
      const weekendDays = await _getWeekendDays();
      const createdRecords = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;

        // Skip weekends — tour on weekends is implicit (no record needed)
        if (!weekendDays.includes(cursor.getDay())) {
          // Check if holiday — skip holidays too
          const holidayName = await _getHolidayName(dateStr);
          if (!holidayName) {
            // Upsert attendance record as 'tour'
            const existing = await AttendanceRecord.findOne({ where: { employee_id: resolvedEmployeeId, date: dateStr }, transaction });
            if (existing) {
              await existing.update({
                status: 'tour',
                check_in_time: null,
                check_out_time: null,
                total_minutes: 0,
                late_by_minutes: 0,
                early_exit_minutes: 0,
                remarks: `On tour: ${title} (${tourCode})`,
              }, { transaction });
              createdRecords.push(existing);
            } else {
              const rec = await AttendanceRecord.create({
                employee_id: resolvedEmployeeId,
                date: dateStr,
                status: 'tour',
                total_minutes: 0,
                remarks: `On tour: ${title} (${tourCode})`,
              }, { transaction });
              createdRecords.push(rec);
            }
          }
        }

        cursor.setDate(cursor.getDate() + 1);
      }

      await transaction.commit();

      // Update monthly attendance for affected months
      const affectedMonths = new Set();
      const c2 = new Date(start);
      while (c2 <= end) {
        affectedMonths.add(`${c2.getFullYear()}-${c2.getMonth() + 1}`);
        c2.setMonth(c2.getMonth() + 1);
      }
      for (const key of affectedMonths) {
        const [yr, mo] = key.split('-').map(Number);
        const anyDate = new Date(yr, mo - 1, 15);
        await this._updateMonthlyAttendance(resolvedEmployeeId, `${yr}-${String(mo).padStart(2, '0')}-${String(anyDate.getDate()).padStart(2, '0')}`);
      }

      return {
        tour,
        attendanceRecordsCreated: createdRecords.length,
        message: `Tour marked successfully. ${createdRecords.length} working day(s) marked as tour (paid).`,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get all tours with pagination + filters.
   */
  async getAllTours({ page = 1, limit = 20, search, status, employee_id, from, to, office_id, company_id } = {}) {
    const where = {};
    if (status) where.status = status;
    if (employee_id) where.employee_id = employee_id;
    if (from || to) {
      where[Op.or] = [];
      if (from && to) {
        where[Op.or].push({ start_date: { [Op.between]: [from, to] } });
        where[Op.or].push({ end_date: { [Op.between]: [from, to] } });
        where[Op.or].push({ [Op.and]: [{ start_date: { [Op.lte]: from } }, { end_date: { [Op.gte]: to } }] });
      } else if (from) {
        where[Op.or].push({ start_date: { [Op.gte]: from } });
        where[Op.or].push({ end_date: { [Op.gte]: from } });
      } else {
        where[Op.or].push({ start_date: { [Op.lte]: to } });
        where[Op.or].push({ end_date: { [Op.lte]: to } });
      }
    }

    const empInclude = { model: Employee, as: 'employee', attributes: ['id', 'employee_id', 'first_name', 'last_name', 'email', 'office_id', 'company_id'], include: [] };
    const empWhere = {};
    if (search) {
      empWhere[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { employee_id: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (office_id) empWhere.office_id = office_id;
    if (company_id) empWhere.company_id = company_id;
    empInclude.where = empWhere;
    empInclude.required = Object.keys(empWhere).length > 0;

    const offset = (page - 1) * limit;
    const { rows, count } = await Tour.findAndCountAll({
      where,
      include: [
        empInclude,
        { model: Employee, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'employee_id'] },
      ],
      order: [['start_date', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return {
      tours: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  /**
   * Get a single tour by ID with its attendance records.
   */
  async getTourById(tourId) {
    const tour = await Tour.findByPk(tourId, {
      include: [
        { model: Employee, as: 'employee', attributes: ['id', 'employee_id', 'first_name', 'last_name', 'email'] },
        { model: Employee, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'employee_id'] },
        { model: Employee, as: 'canceller', attributes: ['id', 'first_name', 'last_name', 'employee_id'] },
      ],
    });
    if (!tour) {
      const err = new Error('Tour not found');
      err.status = 404;
      throw err;
    }

    // Fetch attendance records for the tour date range with status='tour'
    const attendanceRecords = await AttendanceRecord.findAll({
      where: {
        employee_id: tour.employee_id,
        date: { [Op.between]: [tour.start_date, tour.end_date] },
        status: 'tour',
      },
      order: [['date', 'ASC']],
    });

    return { tour, attendanceRecords };
  }

  /**
   * Cancel a tour. Past tour days revert to 'absent' (since employee didn't punch).
   * Future tour days are deleted entirely.
   */
  async cancelTour(tourId, adminId, reason) {
    const tour = await Tour.findByPk(tourId);
    if (!tour) {
      const err = new Error('Tour not found');
      err.status = 404;
      throw err;
    }
    if (tour.status === 'cancelled') {
      const err = new Error('Tour is already cancelled');
      err.status = 400;
      throw err;
    }

    const todayStr = getLocalDateString();
    const transaction = await sequelize.transaction();
    const affectedMonths = new Set();
    try {
      // Find all tour attendance records for this tour's date range
      const tourRecords = await AttendanceRecord.findAll({
        where: {
          employee_id: tour.employee_id,
          date: { [Op.between]: [tour.start_date, tour.end_date] },
          status: 'tour',
        },
        transaction,
      });

      for (const rec of tourRecords) {
        const [yr, mo] = rec.date.split('-').map(Number);
        affectedMonths.add(`${yr}-${mo}`);

        if (rec.date < todayStr) {
          // Past date — employee didn't actually punch, so mark absent
          await rec.update({
            status: 'absent',
            remarks: `Tour cancelled (${tour.tour_code}). Marked absent.`,
          }, { transaction });
        } else {
          // Today or future — delete the record entirely
          await rec.destroy({ transaction });
        }
      }

      await tour.update({
        status: 'cancelled',
        cancelled_by: adminId,
        cancelled_at: new Date(),
        cancel_reason: reason || null,
      }, { transaction });

      await transaction.commit();

      // Rebuild monthly attendance for affected months
      for (const key of affectedMonths) {
        const [yr, mo] = key.split('-').map(Number);
        const anyDate = new Date(yr, mo - 1, 15);
        await this._updateMonthlyAttendance(tour.employee_id, `${yr}-${String(mo).padStart(2, '0')}-${String(anyDate.getDate()).padStart(2, '0')}`);
      }

      return { tour, message: 'Tour cancelled successfully.' };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Check if an employee is currently on tour (for mobile app).
   */
  async getEmployeeTourStatus(employeeId) {
    const todayStr = getLocalDateString();
    const activeTour = await Tour.findOne({
      where: {
        employee_id: employeeId,
        status: 'active',
        start_date: { [Op.lte]: todayStr },
        end_date: { [Op.gte]: todayStr },
      },
      order: [['start_date', 'DESC']],
    });

    if (!activeTour) {
      return { isOnTour: false, tour: null };
    }

    return {
      isOnTour: true,
      tour: {
        id: activeTour.id,
        tour_code: activeTour.tour_code,
        title: activeTour.title,
        description: activeTour.description,
        from_location: activeTour.from_location,
        to_location: activeTour.to_location,
        start_date: activeTour.start_date,
        end_date: activeTour.end_date,
      },
    };
  }
}

module.exports = new AttendanceService();