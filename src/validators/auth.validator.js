const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
});

const registerSchema = Joi.object({
  // ── Core identity (required) ──
  emp_code: Joi.string().max(20).required(),
  name: Joi.string().max(100).required(),
  email: Joi.string().email().max(150).required(),
  phone: Joi.string().max(20).optional().allow(null, ''),
  password: Joi.string().min(6).required(),
  designation: Joi.string().max(80).optional().allow(null, ''),
  department: Joi.string().max(80).optional().allow(null, ''),
  role: Joi.string().valid('admin', 'hr', 'manager', 'employee').default('employee'),
  date_of_joining: Joi.date().optional().allow(null, ''),
  date_of_birth: Joi.date().optional().allow(null, ''),
  gender: Joi.string().valid('male', 'female', 'other').optional().allow(null, ''),
  address: Joi.string().optional().allow(null, ''),
  office_id: Joi.number().integer().optional().allow(null, ''),
  company_id: Joi.number().integer().optional().allow(null, ''),

  // ── Shift configuration ──
  shift_start_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .optional().allow(null, '')
    .messages({
      'string.pattern.base': 'Shift start time must be in HH:MM or HH:MM:SS format',
    }),
  shift_end_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .optional().allow(null, '')
    .messages({
      'string.pattern.base': 'Shift end time must be in HH:MM or HH:MM:SS format',
    }),
  half_day_late_minutes: Joi.number().integer().min(1).max(480).default(60).optional().allow(null, ''),

  // ── Salary configuration ──
  fixed_gross: Joi.number().min(0).optional().allow(null, ''),
  hra_applicable: Joi.boolean().default(true),
  pf_applicable: Joi.boolean().default(true),
  pf_ceiling: Joi.boolean().default(false),
  // PF & ESIC contribution modes + rates (Phase 8)
  pf_contribution_mode: Joi.string().valid('none', 'employee_only', 'employer_only', 'shared').default('shared'),
  pf_employee_rate: Joi.number().min(0).max(1).default(0.12),
  pf_employer_rate: Joi.number().min(0).max(1).default(0.12),
  esic_applicable: Joi.boolean().default(false),
  esic_contribution_mode: Joi.string().valid('none', 'employee_only', 'employer_only', 'shared').default('shared'),
  esic_employee_rate: Joi.number().min(0).max(1).default(0.0075),
  esic_employer_rate: Joi.number().min(0).max(1).default(0.0325),
  pt_applicable: Joi.boolean().default(true),
  effective_work_days: Joi.number().integer().min(1).max(31).default(26),

  // ── Bank details ──
  bank_name: Joi.string().max(100).optional().allow(null, ''),
  bank_account_number: Joi.string().max(30).optional().allow(null, ''),
  ifsc_code: Joi.string().max(11).optional().allow(null, ''),

  // ── Statutory identifiers ──
  pan_number: Joi.string().max(10).optional().allow(null, ''),
  pf_number: Joi.string().max(30).optional().allow(null, ''),
  uan: Joi.string().max(12).optional().allow(null, ''),

  // ── Location / Company ──
  location: Joi.string().max(150).optional().allow(null, ''),
  company_name: Joi.string().max(200).optional().allow(null, ''),

  // ── Emergency contact ──
  emergency_contact_name: Joi.string().max(100).optional().allow(null, ''),
  emergency_contact_relation: Joi.string().max(50).optional().allow(null, ''),

  // ── Salary structure extras (flat allowances) ──
  special_allowance: Joi.number().min(0).optional().allow(null, ''),
  conveyance: Joi.number().min(0).optional().allow(null, ''),
  medical_allowance: Joi.number().min(0).optional().allow(null, ''),
  performance_allowance: Joi.number().min(0).optional().allow(null, ''),
  annual_ctc: Joi.number().min(0).optional().allow(null, ''),

  // ── Offer letter toggle ──
  send_offer_letter: Joi.boolean().default(false),
});

const salaryStructureSchema = Joi.object({
  fixed_gross: Joi.number().min(0).required(),
  hra_applicable: Joi.boolean().default(true),
  pf_applicable: Joi.boolean().default(true),
  pf_ceiling: Joi.boolean().default(false),
  // PF & ESIC contribution modes + rates (Phase 8)
  pf_contribution_mode: Joi.string().valid('none', 'employee_only', 'employer_only', 'shared').default('shared'),
  pf_employee_rate: Joi.number().min(0).max(1).default(0.12),
  pf_employer_rate: Joi.number().min(0).max(1).default(0.12),
  esic_applicable: Joi.boolean().default(false),
  esic_contribution_mode: Joi.string().valid('none', 'employee_only', 'employer_only', 'shared').default('shared'),
  esic_employee_rate: Joi.number().min(0).max(1).default(0.0075),
  esic_employer_rate: Joi.number().min(0).max(1).default(0.0325),
  pt_applicable: Joi.boolean().default(true),
  effective_work_days: Joi.number().integer().min(1).max(31).default(26),
  special_allowance: Joi.number().min(0).optional().allow(null, ''),
  conveyance: Joi.number().min(0).optional().allow(null, ''),
  medical_allowance: Joi.number().min(0).optional().allow(null, ''),
  performance_allowance: Joi.number().min(0).optional().allow(null, ''),
  annual_ctc: Joi.number().min(0).optional().allow(null, ''),
  effective_from: Joi.date().optional().allow(null, ''),
  remarks: Joi.string().max(500).optional().allow(null, ''),
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(6).required().messages({
    'string.min': 'New password must be at least 6 characters',
  }),
});

const refreshTokenSchema = Joi.object({
  refresh_token: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required().messages({
    'any.required': 'Reset token is required',
  }),
  new_password: Joi.string().min(6).required().messages({
    'string.min': 'New password must be at least 6 characters',
    'any.required': 'New password is required',
  }),
});

module.exports = {
  loginSchema,
  registerSchema,
  salaryStructureSchema,
  changePasswordSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};