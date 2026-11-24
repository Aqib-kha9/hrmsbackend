const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const {
  payslipQuerySchema,
  updateEntrySchema,
  updateEntryStatusSchema,
  disburseSchema,
  historyQuerySchema,
  ledgerQuerySchema,
  financialSummaryQuerySchema,
} = require('../validators/payroll.validator');
const payrollController = require('../controllers/payroll.controller');
const payrollLedgerController = require('../controllers/payroll_ledger.controller');
const salaryStructureController = require('../controllers/salary_structure.controller');
const multer = require('multer');
const uploadExcel = multer({ storage: multer.memoryStorage() });

// All routes require authentication
router.use(authenticate);

// ── CTC Structure Calculator & Wage Code Master Engine ──
router.post('/calculate-ctc', (req, res, next) => salaryStructureController.calculateCTC(req, res, next));
router.get('/minimum-wages', (req, res, next) => salaryStructureController.getMinimumWages(req, res, next));
router.post('/minimum-wages', requirePermission('payroll:update'), (req, res, next) => salaryStructureController.updateMinimumWage(req, res, next));
router.get('/pt-slabs', (req, res, next) => salaryStructureController.getPTSlabs(req, res, next));

// ── Employee Salary Structure Roster & Bulk Management ──
router.get('/salary-structures', requirePermission('payroll:read'), (req, res, next) => salaryStructureController.getSalaryStructures(req, res, next));
router.put('/salary-structures/:employeeId', requirePermission('payroll:update'), (req, res, next) => salaryStructureController.updateEmployeeSalaryStructure(req, res, next));
router.post('/salary-structures/import-client-excel', requirePermission('payroll:update'), uploadExcel.single('file'), (req, res, next) => salaryStructureController.importClientExcel(req, res, next));
router.get('/salary-structures/export-excel', requirePermission('payroll:read'), (req, res, next) => salaryStructureController.exportSalaryStructuresExcel(req, res, next));

// ── Legacy payslip routes ──
router.get('/payslips', payrollController.getMyPayslips);
router.get('/payslips/:id/download', payrollController.downloadPayslipPdf);
router.get('/payslips/:id', payrollController.getPayslipById);
router.get('/current', payrollController.getCurrentPayslip);

// Admin/HR — legacy payslip
router.get('/employee/:employeeId', selfOrAdmin(), validate(payslipQuerySchema, 'query'), payrollController.getEmployeePayslips);
router.get('/employee/:employeeId/history', requirePermission('payroll:read'), payrollLedgerController.getEmployeeHistory);
router.post('/generate', requirePermission('payroll:create'), payrollController.generatePayslips);
router.patch('/payslips/:id/mark-paid', requirePermission('payroll:approve'), payrollController.markPayslipPaid);

// ── Payroll ledger routes (new) ──

// GET /payroll/ledger — current-cycle ledger with full calculations
router.get('/ledger', requirePermission('payroll:read'), validate(ledgerQuerySchema, 'query'), payrollLedgerController.getCurrentLedger);

// GET /payroll/financial-summary — Section 2.9 Financial & Analytical Summary
router.get('/financial-summary', requirePermission('payroll:read'), validate(financialSummaryQuerySchema, 'query'), payrollLedgerController.getFinancialSummary);

// GET /payroll/ledger/:cycleId — specific cycle
router.get('/ledger/:cycleId', requirePermission('payroll:read'), validate(ledgerQuerySchema, 'query'), payrollLedgerController.getLedgerByCycleId);

// GET /payroll/history — past cycles summary
router.get('/history', requirePermission('payroll:read'), validate(historyQuerySchema, 'query'), payrollLedgerController.getCycleHistory);

// PATCH /payroll/entry/:entryId — update single entry (HR can edit allowances/deductions)
router.patch('/entry/:entryId', requirePermission('payroll:update'), validate(updateEntrySchema, 'body'), payrollLedgerController.updateEntry);

// PATCH /payroll/entry/:entryId/status — change entry status
router.patch('/entry/:entryId/status', requirePermission('payroll:update'), validate(updateEntryStatusSchema, 'body'), payrollLedgerController.updateEntryStatus);

// GET /payroll/entry/:entryId/pdf — Download PDF Salary Slip (Req 3.1)
router.get('/entry/:entryId/pdf', payrollLedgerController.downloadEntryPayslip);

// POST /payroll/entry/:entryId/send-email — Email Payslip to employee (Req 3.1)
router.post('/entry/:entryId/send-email', requirePermission('payroll:export'), payrollLedgerController.emailEntryPayslip);

// POST /payroll/cycle/:cycleId/send-all-payslips — Batch email all payslips (Req 3.1)
router.post('/cycle/:cycleId/send-all-payslips', requirePermission('payroll:export'), payrollLedgerController.emailAllCyclePayslips);

// POST /payroll/disburse/:cycleId — disburse entire cycle (FINAL AUTHORITY: requires payroll:approve)
router.post('/disburse/:cycleId', requirePermission('payroll:approve'), validate(disburseSchema, 'body'), payrollLedgerController.disburseCycle);

module.exports = router;