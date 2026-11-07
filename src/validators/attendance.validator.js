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
  status: Joi.string().valid('Present', 'Absent', 'Half Day', 'Late').required()
    .messages({
      'any.only': 'Status must be Present, Absent, Half Day, or Late',
      'any.required': 'Status is required',
    }),
  reason: Joi.string().allow('', null).max(500).optional(),
  is_outdoor: Joi.boolean().optional(),
  check_in_time: Joi.string().optional(),
  check_out_time: Joi.string().optional(),
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
};