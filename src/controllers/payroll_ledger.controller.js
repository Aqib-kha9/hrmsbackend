const payrollLedgerService = require('../services/payroll_ledger.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class PayrollLedgerController {
  // ── GET /payroll/ledger — current-cycle ledger rows ──
  async getCurrentLedger(req, res, next) {
    try {
      const result = await payrollLedgerService.getCurrentLedger();
      return success(res, 'Current ledger fetched', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] getCurrentLedger error: ${err.message}`);
      return next(err);
    }
  }

  // ── GET /payroll/ledger/:cycleId — specific cycle detail ──
  async getLedgerByCycleId(req, res, next) {
    try {
      const { cycleId } = req.params;
      const result = await payrollLedgerService.getLedgerByCycleId(cycleId);
      return success(res, 'Ledger cycle fetched', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] getLedgerByCycleId error: ${err.message}`);
      return next(err);
    }
  }

  // ── GET /payroll/history — past cycles summary ──
  async getCycleHistory(req, res, next) {
    try {
      const { page = 1, limit = 20, year } = req.query;
      const result = await payrollLedgerService.getCycleHistory({ page, limit, year });
      return paginated(res, 'Cycle history fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] getCycleHistory error: ${err.message}`);
      return next(err);
    }
  }

  // ── PATCH /payroll/entry/:entryId — update a single entry ──
  async updateEntry(req, res, next) {
    try {
      const { entryId } = req.params;
      const data = req.body;
      const result = await payrollLedgerService.updateEntry(entryId, data);
      return success(res, 'Entry updated', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] updateEntry error: ${err.message}`);
      return next(err);
    }
  }

  // ── PATCH /payroll/entry/:entryId/status — change entry status ──
  async updateEntryStatus(req, res, next) {
    try {
      const { entryId } = req.params;
      const { status: newStatus } = req.body;
      const result = await payrollLedgerService.updateEntryStatus(entryId, newStatus);
      return success(res, 'Entry status updated', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] updateEntryStatus error: ${err.message}`);
      return next(err);
    }
  }

  // ── POST /payroll/disburse/:cycleId — disburse entire cycle ──
  async disburseCycle(req, res, next) {
    try {
      const { cycleId } = req.params;
      const { mode, reference, authorizedBy, remarks, sendEmails } = req.body;
      const result = await payrollLedgerService.disburseCycle(cycleId, {
        mode,
        reference,
        authorizedBy,
        remarks,
        sendEmails: Boolean(sendEmails),
      });
      return success(res, 'Cycle disbursed successfully', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] disburseCycle error: ${err.message}`);
      return next(err);
    }
  }

  // ── GET /payroll/employee/:employeeId/history — employee historical payroll entries ──
  async getEmployeeHistory(req, res, next) {
    try {
      const { employeeId } = req.params;
      const { year } = req.query;
      const result = await payrollLedgerService.getEmployeeHistory(employeeId, { year });
      return success(res, 'Employee payroll history fetched', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] getEmployeeHistory error: ${err.message}`);
      return next(err);
    }
  }

  // ── GET /payroll/entry/:entryId/pdf — Download PDF Payslip (Req 3.1) ──
  async downloadEntryPayslip(req, res, next) {
    try {
      const { entryId } = req.params;
      const pdfBuffer = await payrollLedgerService.generateEntryPayslipPDF(entryId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Salary_Slip_Entry_${entryId}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`[PayrollLedger] downloadEntryPayslip error: ${err.message}`);
      return next(err);
    }
  }

  // ── POST /payroll/entry/:entryId/send-email — Email Payslip to Employee (Req 3.1) ──
  async emailEntryPayslip(req, res, next) {
    try {
      const { entryId } = req.params;
      const { email } = req.body;
      const result = await payrollLedgerService.sendPayslipEmail(entryId, email);
      return success(res, 'Payslip emailed successfully', result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] emailEntryPayslip error: ${err.message}`);
      return next(err);
    }
  }

  // ── POST /payroll/cycle/:cycleId/send-all-payslips — Batch Email Cycle Payslips (Req 3.1) ──
  async emailAllCyclePayslips(req, res, next) {
    try {
      const { cycleId } = req.params;
      const result = await payrollLedgerService.sendAllCyclePayslips(cycleId);
      return success(res, `Payslip email dispatch completed: ${result.sent} sent, ${result.failed} failed`, result, 200);
    } catch (err) {
      logger.error(`[PayrollLedger] emailAllCyclePayslips error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new PayrollLedgerController();