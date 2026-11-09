const Joi = require('joi');

// ── Legacy payslip schemas ──
const payslipQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).optional(),
  year: Joi.number().integer().min(2020).max(2030).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// ── Ledger schemas ──
const updateEntrySchema = Joi.object({
  absent_days: Joi.number().min(0).max(31).optional(),
  leave_adjustment_days: Joi.number().optional(),
  leave_carry_forward_days: Joi.number().min(0).optional(),
  manual_payable_days: Joi.number().min(0).max(31).allow(null).optional(),
  admin_notes: Joi.string().max(1000).allow('', null).optional(),
  present_days: Joi.number().min(0).max(31).optional(),
  paid_leave_days: Joi.number().min(0).max(31).optional(),
  lwp_days: Joi.number().min(0).max(31).optional(),
  total_muster_days: Joi.number().integer().min(1).max(31).optional(),
  bonus: Joi.number().min(0).optional(),
  previous_arrears: Joi.number().min(0).optional(),
  incentive: Joi.number().min(0).optional(),
  loan_deduction: Joi.number().min(0).optional(),
  other_deduction: Joi.number().min(0).optional(),
  status: Joi.string().valid('Draft', 'Verified', 'Paid', 'Pending Audit').optional(),
}).min(1);

const updateEntryStatusSchema = Joi.object({
  status: Joi.string().valid('Draft', 'Verified', 'Paid', 'Pending Audit').required(),
});

const disburseSchema = Joi.object({
  mode: Joi.string().max(50).required(),
  reference: Joi.string().max(100).optional().allow(''),
  authorizedBy: Joi.string().max(100).required(),
  remarks: Joi.string().max(500).optional().allow(''),
  sendEmails: Joi.boolean().optional(),
});

const historyQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  year: Joi.number().integer().min(2020).max(2030).optional(),
  company_id: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  company: Joi.string().optional(),
});

const ledgerQuerySchema = Joi.object({
  company_id: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  company: Joi.string().optional(),
});

const financialSummaryQuerySchema = Joi.object({
  periodType: Joi.string().valid('monthly', 'yearly').default('monthly'),
  year: Joi.number().integer().min(2020).max(2035).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  company_id: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  company: Joi.string().optional(),
});

module.exports = {
  payslipQuerySchema,
  updateEntrySchema,
  updateEntryStatusSchema,
  disburseSchema,
  historyQuerySchema,
  ledgerQuerySchema,
  financialSummaryQuerySchema,
};