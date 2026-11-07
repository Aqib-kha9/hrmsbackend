const payrollService = require('../services/payroll.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');
const PDFDocument = require('pdfkit');
const { salaryToWords } = require('../utils/amount-to-words');

// Company logo embedded as base64 buffer — deploys with source code,
// no file-system dependency required on the production server.
const COMPANY_LOGO_BUFFER = require('../config/company_logo');

class PayrollController {
  async getMyPayslips(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { page, limit, year } = req.query;
      const result = await payrollService.getPayslips(employeeId, { page, limit, year });
      return paginated(res, 'Payslips fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get my payslips error: ${err.message}`);
      return next(err);
    }
  }

  async getPayslipById(req, res, next) {
    try {
      const { id } = req.params;
      const employeeId = req.employee.id;
      const result = await payrollService.getPayslipById(id, employeeId);
      return success(res, 'Payslip fetched', result, 200);
    } catch (err) {
      logger.error(`Get payslip by id error: ${err.message}`);
      return next(err);
    }
  }

  async getCurrentPayslip(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const result = await payrollService.getCurrentPayslip(employeeId);
      return success(res, 'Current payslip fetched', result, 200);
    } catch (err) {
      logger.error(`Get current payslip error: ${err.message}`);
      return next(err);
    }
  }

  async getEmployeePayslips(req, res, next) {
    try {
      const { employeeId } = req.params;
      const { page, limit, year } = req.query;
      const result = await payrollService.getPayslips(employeeId, { page, limit, year });
      return paginated(res, 'Employee payslips fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get employee payslips error: ${err.message}`);
      return next(err);
    }
  }

  async generatePayslips(req, res, next) {
    try {
      const { month, year, employeeIds } = req.body;
      const result = await payrollService.generatePayslips(month, year, employeeIds);
      return success(res, 'Payslips generated successfully', result, 201);
    } catch (err) {
      logger.error(`Generate payslips error: ${err.message}`);
      return next(err);
    }
  }

  async markPayslipPaid(req, res, next) {
    try {
      const { id } = req.params;
      const result = await payrollService.markPayslipPaid(id);
      return success(res, 'Payslip marked as paid', result, 200);
    } catch (err) {
      logger.error(`Mark payslip paid error: ${err.message}`);
      return next(err);
    }
  }

  async downloadPayslipPdf(req, res, next) {
    try {
      const { id } = req.params;
      const employeeId = req.employee.id;
      const payslip = await payrollService.getPayslipById(id, employeeId);

      const { Employee, Office, Company } = require('../models');
      const emp = await Employee.findByPk(payslip.employee_id, {
        include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }],
      });
      if (!emp) throw new Error('Employee not found');

      const payslipPdfService = require('../services/payslip_pdf.service');

      const totalMuster = payslip.working_days || 30;
      const payableDays = payslip.paid_days || totalMuster;
      const lwpDays = payslip.lop_days !== undefined && payslip.lop_days !== null
        ? payslip.lop_days
        : Math.max(0, totalMuster - payableDays);

      const payslipData = {
        employee_name: emp.name,
        emp_code: emp.emp_code,
        designation: emp.designation,
        department: emp.department,
        location: emp.location || emp.office?.name,
        office_address: emp.office?.address,
        company_name: emp.company_name || emp.company?.name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
        month: payslip.month,
        year: payslip.year,
        uan: emp.uan,
        pf_number: emp.pf_number,
        pan_number: emp.pan_number,
        bank_name: emp.bank_name,
        bank_account_number: emp.bank_account_number,
        // Attendance Information (Req 3.2)
        total_muster_days: totalMuster,
        present_days: payableDays,
        payable_days: payableDays,
        lwp_days: lwpDays,
        // Standard Structure (Req 3.3)
        fixed_gross: emp.fixed_gross || 0,
        // Earnings & Deductions
        basic_salary: payslip.basic_salary,
        hra: payslip.hra,
        other_allowance: payslip.other_allowance || payslip.special_allowance,
        special_allowance: payslip.special_allowance,
        conveyance: payslip.conveyance,
        medical_allowance: payslip.medical_allowance,
        gross_salary: payslip.gross_salary,
        total_earnings: payslip.gross_salary,
        pf_employee: payslip.pf_employee,
        esi_employee: payslip.esi_employee,
        professional_tax: payslip.professional_tax,
        total_deductions: payslip.total_deductions,
        net_salary: payslip.net_salary,
        pf_employer: payslip.pf_employer,
        esi_employer: payslip.esi_employer,
        ctc: payslip.ctc,
      };

      const pdfBuffer = await payslipPdfService.generatePayslipPDF(payslipData);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Payslip_${emp.name.replace(/\s+/g, '_')}_${payslip.month}_${payslip.year}.pdf"`
      );
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`Download payslip PDF error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new PayrollController();