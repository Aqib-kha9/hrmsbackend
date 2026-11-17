const Joi = require('joi');
const { GEO_FENCE } = require('../utils/constants');

const createOfficeSchema = Joi.object({
  company_id: Joi.number().integer().required().messages({
    'any.required': 'Company is required',
    'number.base': 'Company ID must be a number',
  }),
  code: Joi.string().trim().max(20).allow('', null).optional(),
  name: Joi.string().trim().max(100).required().messages({
    'any.required': 'Office name is required',
    'string.max': 'Office name must be at most 100 characters',
  }),
  address: Joi.string().trim().allow('', null).optional(),
  city: Joi.string().trim().max(100).allow('', null).optional(),
  state: Joi.string().trim().max(100).allow('', null).optional(),
  latitude: Joi.number().min(-90).max(90).required().messages({
    'any.required': 'Latitude is required for geo-fencing',
    'number.min': 'Latitude must be at least -90',
    'number.max': 'Latitude must be at most 90',
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    'any.required': 'Longitude is required for geo-fencing',
    'number.min': 'Longitude must be at least -180',
    'number.max': 'Longitude must be at most 180',
  }),
  radius_meters: Joi.number().min(GEO_FENCE.MIN_RADIUS || 10).max(GEO_FENCE.MAX_RADIUS).default(GEO_FENCE.DEFAULT_RADIUS).messages({
    'number.min': `Radius must be at least ${GEO_FENCE.MIN_RADIUS || 10} meters`,
    'number.max': `Radius must be at most ${GEO_FENCE.MAX_RADIUS} meters`,
  }),
  contact_person: Joi.string().trim().max(100).allow('', null).optional(),
  contact_phone: Joi.string().trim().max(20).allow('', null).pattern(/^[+]?[\d\s()-]{7,20}$/).optional().messages({
    'string.pattern.base': 'Contact phone must be a valid phone number (7-20 digits, optional + prefix)',
  }),
  is_active: Joi.boolean().default(true),
});

const updateOfficeSchema = Joi.object({
  company_id: Joi.number().integer().optional(),
  code: Joi.string().trim().max(20).optional(),
  name: Joi.string().trim().max(100).optional(),
  address: Joi.string().trim().allow('', null).optional(),
  city: Joi.string().trim().max(100).allow('', null).optional(),
  state: Joi.string().trim().max(100).allow('', null).optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  radius_meters: Joi.number().min(GEO_FENCE.MIN_RADIUS || 10).max(GEO_FENCE.MAX_RADIUS).optional(),
  contact_person: Joi.string().trim().max(100).allow('', null).optional(),
  contact_phone: Joi.string().trim().max(20).allow('', null).pattern(/^[+]?[\d\s()-]{7,20}$/).optional().messages({
    'string.pattern.base': 'Contact phone must be a valid phone number (7-20 digits, optional + prefix)',
  }),
  is_active: Joi.boolean().optional(),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});

const officeQuerySchema = Joi.object({
  search: Joi.string().trim().allow('').optional(),
  company_id: Joi.number().integer().optional(),
  city: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  is_active: Joi.boolean().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  createOfficeSchema,
  updateOfficeSchema,
  officeQuerySchema,
};