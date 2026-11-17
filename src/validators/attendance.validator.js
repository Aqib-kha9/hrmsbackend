const Joi = require('joi');

const punchInSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  office_id: Joi.number().integer().optional(),
  photo_path: Joi.string().optional(),
  is_outdoor: Joi.boolean().optional(),
  is_field_duty: Joi.boolean().optional(),
  remarks: Joi.string().allow('', null).optional(),
  reason: Joi.string().allow('', null).optional(),
  check_in_method: Joi.string().optional(),
});

const punchOutSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  photo_path: Joi.string().optional(),
  is_outdoor: Joi.boolean().optional(),
  is_field_duty: Joi.boolean().optional(),
  remarks: Joi.string().allow('', null).optional(),
  reason: Joi.string().allow('', null).optional(),
  check_in_method: Joi.string().optional(),
});

const monthlyQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).optional(),
  year: Joi.number().integer().min(2020).max(2030).optional(),
  cycle_type: Joi.string().valid('payroll', 'calendar').optional(),
});

const adminLiveQuerySchema = Joi.object({
  office_id: Joi.number().integer().optional(),
  company_id: Joi.number().integer().optional(),
  search: Joi.string().allow('', null).optional(),
  status: Joi.string().valid('Present', 'Absent', 'Late', 'Half Day', 'On Leave', 'Weekend').optional(),
  page: Joi.number().integer().min(1).optional(),
  // Allow a high limit so the frontend can export ALL matching employees
  // in a single request (not just the current page of 8).
  limit: Joi.number().integer().min(1).max(100000).optional(),
  department: Joi.string().allow('', null).optional(),
});

const adminHistoryQuerySchema = Joi.object({
  office_id: Joi.number().integer().optional(),
  company_id: Joi.number().integer().optional(),
  search: Joi.string().allow('', null).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  department: Joi.string().allow('', null).optional(),
});

const adminMonthlyQuerySchema = Joi.object({
  office_id: Joi.number().integer().optional(),
  company_id: Joi.number().integer().optional(),
  search: Joi.string().allow('', null).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  year: Joi.number().integer().min(2020).max(2030).optional(),
  department: Joi.string().allow('', null).optional(),
  cycle_type: Joi.string().valid('payroll', 'calendar').optional(),
  cycle: Joi.string().valid('payroll', 'calendar').optional(),
});

const manualEntrySchema = Joi.object({
  employeeId: Joi.alternatives().try(
    Joi.string().trim(),
    Joi.number().integer().positive()
  ).required()
    .messages({
      'any.required': 'Employee ID is required',
    }),
  date: Joi.date().iso().required()
    .messages({
      'date.format': 'Date must be in YYYY-MM-DD format',
      'any.required': 'Date is required',
    }),
  status: Joi.string().valid('Present', 'Absent', 'Half Day', 'Late', 'Weekly Off Worked', 'present', 'absent', 'half_day', 'late', 'weekly_off_worked').required()
    .messages({
      'any.only': 'Status must be Present, Absent, Half Day, Late, or Weekly Off Worked',
      'any.required': 'Status is required',
    }),
  reason: Joi.string().allow('', null).max(500).optional(),
  is_outdoor: Joi.boolean().optional(),
  is_weekly_off_worked: Joi.boolean().optional(),
  weekly_off_compensation: Joi.string().valid('none', 'additional_payable_day', 'comp_off').optional(),
  check_in_time: Joi.string().optional(),
  check_out_time: Joi.string().optional(),
});

const weeklyOffConfigSchema = Joi.object({
  employeeId: Joi.alternatives().try(
    Joi.string().trim(),
    Joi.number().integer().positive()
  ).optional(),
  employeeIds: Joi.array().items(
    Joi.alternatives().try(Joi.string().trim(), Joi.number().integer().positive())
  ).optional(),
  weekly_off_days: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim().allow('')
  ).optional(),
  rotational_weekly_off: Joi.boolean().optional(),
  weekly_off_type: Joi.string().valid('fixed', 'rotational').optional(),
  shift_start_time: Joi.string().allow('', null).optional(),
  shift_end_time: Joi.string().allow('', null).optional(),
  is_rotational_shift: Joi.boolean().optional(),
  half_day_late_minutes: Joi.number().integer().min(0).max(480).optional(),
  weekly_shift_schedule: Joi.object().allow(null).optional(),
});

// ── Tour management schemas ──
const markTourSchema = Joi.object({
  employeeId: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().trim()
  ).required()
    .messages({
      'any.required': 'Employee ID is required',
    }),
  title: Joi.string().trim().min(3).max(200).required()
    .messages({
      'string.empty': 'Tour title is required',
      'string.min': 'Tour title must be at least 3 characters',
      'any.required': 'Tour title is required',
    }),
  description: Joi.string().allow('', null).max(2000).optional(),
  fromLocation: Joi.string().allow('', null).max(150).optional(),
  toLocation: Joi.string().allow('', null).max(150).optional(),
  startDate: Joi.date().iso().required()
    .messages({
      'date.format': 'Start date must be in YYYY-MM-DD format',
      'any.required': 'Start date is required',
    }),
  endDate: Joi.date().iso().required()
    .messages({
      'date.format': 'End date must be in YYYY-MM-DD format',
      'any.required': 'End date is required',
    }),
}).custom((value, helpers) => {
  if (new Date(value.endDate) < new Date(value.startDate)) {
    return helpers.error('any.invalid', { message: 'End date cannot be before start date' });
  }
  return value;
});

const tourListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().allow('', null).optional(),
  status: Joi.string().valid('active', 'completed', 'cancelled').optional(),
  employee_id: Joi.number().integer().optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  office_id: Joi.number().integer().optional(),
  company_id: Joi.number().integer().optional(),
});

const cancelTourSchema = Joi.object({
  reason: Joi.string().allow('', null).max(500).optional(),
});

const regularizeApplySchema = Joi.object({
  date: Joi.string().required(),
  regularization_type: Joi.string().valid(
    'forgot_punch',
    'forgot_check_in',
    'forgot_check_out',
    'on_duty',
    'wfh',
    'technical_issue',
    'other'
  ).default('forgot_punch'),
  requested_check_in: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).allow('', null).optional(),
  requested_check_out: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).allow('', null).optional(),
  reason: Joi.string().min(3).max(1000).required(),
});

const regularizeListQuerySchema = Joi.object({
  status: Joi.string().valid('all', 'pending', 'approved', 'rejected', 'cancelled').optional(),
  company_id: Joi.number().integer().optional(),
  office_id: Joi.number().integer().optional(),
  department: Joi.string().allow('', null).optional(),
  search: Joi.string().allow('', null).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  year: Joi.number().integer().min(2020).max(2030).optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

const regularizeActionSchema = Joi.object({
  action: Joi.string().valid('approved', 'rejected').required(),
  admin_remarks: Joi.string().allow('', null).max(500).optional(),
  status: Joi.string().valid('present', 'half_day').optional().default('present'),
});

module.exports = {
  punchInSchema,
  punchOutSchema,
  monthlyQuerySchema,
  manualEntrySchema,
  adminLiveQuerySchema,
  adminHistoryQuerySchema,
  adminMonthlyQuerySchema,
  markTourSchema,
  tourListQuerySchema,
  cancelTourSchema,
  weeklyOffConfigSchema,
  regularizeApplySchema,
  regularizeListQuerySchema,
  regularizeActionSchema,
};