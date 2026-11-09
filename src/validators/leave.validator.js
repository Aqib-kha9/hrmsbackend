const Joi = require('joi');

const applyLeaveSchema = Joi.object({
  leave_type: Joi.string().valid('pl', 'el', 'cl', 'lwp', 'comp_off', 'other').default('cl'),
  employee_id: Joi.number().integer().optional().messages({
    'number.base': 'Employee ID must be a valid number',
  }),
  is_half_day: Joi.boolean().optional(),
  half_day_session: Joi.string().valid('first_half', 'second_half').optional(),
  from_date: Joi.string().custom((value, helpers) => {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return helpers.error('date.format');
    }
    // Compare date-only (strip time) so same-day applications are allowed
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inputDay = new Date(d);
    inputDay.setHours(0, 0, 0, 0);
    if (inputDay < today) {
      return helpers.error('date.min');
    }
    return d.toISOString().split('T')[0];
  }).required().messages({
    'date.min': 'Start date cannot be in the past',
    'date.format': 'Start date must be a valid date (YYYY-MM-DD)',
    'any.required': 'Start date is required',
  }),
  to_date: Joi.string().custom((value, helpers) => {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return helpers.error('date.format');
    }
    // Compare against from_date (already converted to Date by Joi)
    const { from_date } = helpers.state.ancestors[0] || {};
    if (from_date) {
      const fromDay = new Date(from_date);
      fromDay.setHours(0, 0, 0, 0);
      const toDay = new Date(d);
      toDay.setHours(0, 0, 0, 0);
      if (toDay < fromDay) {
        return helpers.error('date.min');
      }
    }
    return d.toISOString().split('T')[0];
  }).required().messages({
    'date.min': 'End date must be on or after start date',
    'date.format': 'End date must be a valid date (YYYY-MM-DD)',
    'any.required': 'End date is required',
  }),
  duration: Joi.number().min(0.5).max(30).required().messages({
    'number.min': 'Duration must be at least 0.5 days',
    'number.max': 'Duration cannot exceed 30 days',
    'any.required': 'Duration is required',
  }),
  reason: Joi.string().min(5).max(500).trim().required().messages({
    'string.min': 'Reason must be at least 5 characters',
    'string.max': 'Reason must be under 500 characters',
    'any.required': 'Reason is required',
  }),
  contact_during_leave: Joi.string().max(20).optional(),
});

const approveLeaveSchema = Joi.object({
  action: Joi.string().valid('approved', 'rejected').required().messages({
    'any.required': 'Action (approved/rejected) is required',
  }),
  remarks: Joi.string().max(500).allow('').optional(),
  payroll_treatment: Joi.string().valid('paid', 'unpaid', 'adjusted_balance', 'deducted_current', 'carry_forward_next').optional(),
});

const grantLeaveSchema = Joi.object({
  employeeId: Joi.number().integer().required().messages({
    'any.required': 'Employee ID is required',
  }),
  count: Joi.number().integer().min(1).max(30).required().messages({
    'number.min': 'Grant count must be at least 1',
    'any.required': 'Count is required',
  }),
  reason: Joi.string().min(5).max(500).required().messages({
    'string.min': 'Reason must be at least 5 characters',
    'any.required': 'Reason is required',
  }),
});

const leaveQuerySchema = Joi.object({
  status: Joi.string().valid('pending', 'approved', 'rejected', 'cancelled').optional(),
  department: Joi.string().optional(),
  search: Joi.string().allow('').optional(),
  from: Joi.string().isoDate().optional(),
  to: Joi.string().isoDate().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const leaveHistoryQuerySchema = Joi.object({
  year: Joi.number().integer().min(2020).max(2050).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
});

const leaveSummaryQuerySchema = Joi.object({
  year: Joi.number().integer().min(2020).max(2050).optional(),
  department: Joi.string().allow('').optional(),
  search: Joi.string().allow('').optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});

const leavePolicySchema = Joi.object({
  pl: Joi.object({
    entitlement: Joi.number().min(0).max(60).default(12),
    carry_forward: Joi.boolean().default(true),
    max_carry_forward: Joi.number().min(0).max(60).default(15),
    lapse: Joi.boolean().default(false),
  }).optional(),
  el: Joi.object({
    entitlement: Joi.number().min(0).max(60).default(12),
    carry_forward: Joi.boolean().default(true),
    max_carry_forward: Joi.number().min(0).max(60).default(30),
    lapse: Joi.boolean().default(false),
  }).optional(),
  cl: Joi.object({
    entitlement: Joi.number().min(0).max(60).default(12),
    carry_forward: Joi.boolean().default(false),
    max_carry_forward: Joi.number().min(0).max(0).default(0),
    lapse: Joi.boolean().default(true),
  }).optional(),
});

const rolloverSchema = Joi.object({
  fromYear: Joi.number().integer().min(2020).max(2050).optional(),
  toYear: Joi.number().integer().min(2020).max(2050).optional(),
});

module.exports = {
  applyLeaveSchema,
  approveLeaveSchema,
  grantLeaveSchema,
  leaveQuerySchema,
  leaveHistoryQuerySchema,
  leaveSummaryQuerySchema,
  leavePolicySchema,
  rolloverSchema,
};
