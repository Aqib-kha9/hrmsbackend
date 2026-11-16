const Joi = require('joi');

const updateProfileSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  phone: Joi.string().max(20).optional(),
  designation: Joi.string().max(80).optional(),
  department: Joi.string().max(80).optional(),
  address: Joi.string().optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
  date_of_birth: Joi.date().optional(),
  profile_image: Joi.string().max(500).allow('', null).optional(),
});

// Admin update schema — includes SOW salary, shift, statutory & personal fields
const updateEmployeeSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  phone: Joi.string().max(20).optional(),
  designation: Joi.string().max(80).optional(),
  department: Joi.string().max(80).optional(),
  role: Joi.string().max(50).optional(),
  role_id: Joi.number().integer().optional(),
  address: Joi.string().optional(),
  gender: Joi.string().valid('male', 'female', 'other').optional(),
  date_of_birth: Joi.date().optional(),
  date_of_joining: Joi.date().optional(),
  marital_status: Joi.string().valid('married', 'unmarried', 'other').optional(),
  father_or_husband_name: Joi.string().max(100).allow('', null).optional(),
  emergency_contact_name: Joi.string().max(100).allow('', null).optional(),
  emergency_contact_phone: Joi.string().max(20).allow('', null).optional(),
  emergency_contact_relation: Joi.string().max(50).allow('', null).optional(),
  // Shift & Rotational configuration (Req 2.3 B & 2.5 C)
  shift_start_time: Joi.string().allow('', null).optional(),
  shift_end_time: Joi.string().allow('', null).optional(),
  is_rotational_shift: Joi.boolean().optional(),
  rotational_weekly_off: Joi.boolean().optional(),
  weekly_off_type: Joi.string().valid('fixed', 'rotational').optional(),
  weekly_off_days: Joi.array().items(Joi.string()).optional(),
  half_day_late_minutes: Joi.number().integer().min(0).max(480).optional(),
  // Salary & Statutory fields (Req 2.3 C & 2.4)
  fixed_gross: Joi.number().min(0).optional(),
  basic_salary: Joi.number().min(0).optional(),
  payment_mode: Joi.string().max(50).optional(),
  bank_name: Joi.string().max(100).allow('', null).optional(),
  bank_account_number: Joi.string().max(50).allow('', null).optional(),
  ifsc_code: Joi.string().max(20).allow('', null).optional(),
  pf_applicable: Joi.boolean().optional(),
  pf_ceiling: Joi.boolean().optional(),
  pf_number: Joi.string().max(50).allow('', null).optional(),
  uan: Joi.string().pattern(/^\d{12}$/).allow('', null).optional().messages({
    'string.pattern.base': 'UAN must be exactly 12 digits (e.g. 101234567890)',
  }),
  pf_employment_date: Joi.date().allow(null).optional(),
  esic_applicable: Joi.boolean().optional(),
  esic_number: Joi.string().max(50).allow('', null).optional(),
  office_id: Joi.number().integer().optional(),
  company_id: Joi.number().integer().optional(),
});

const employeeQuerySchema = Joi.object({
  search: Joi.string().optional(),
  department: Joi.string().optional(),
  role: Joi.string().max(50).optional(),
  status: Joi.string().optional(),
  company_id: Joi.number().integer().optional(),
  office_id: Joi.number().integer().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(20),
});

module.exports = { updateProfileSchema, updateEmployeeSchema, employeeQuerySchema };