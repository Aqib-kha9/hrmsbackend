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

// Admin update schema — includes salary config fields
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
  fixed_gross: Joi.number().min(0).optional(),
  basic_salary: Joi.number().min(0).optional(),
  pf_applicable: Joi.boolean().optional(),
  pf_ceiling: Joi.boolean().optional(),
  esic_applicable: Joi.boolean().optional(),
  office_id: Joi.number().integer().optional(),
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