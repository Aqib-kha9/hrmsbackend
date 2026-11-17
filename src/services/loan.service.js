const { Loan, LoanPayment, Employee, Company, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');

class LoanService {
  async getEmployeeLoans(employeeId) {
    const loans = await Loan.findAll({
      where: { employee_id: employeeId },
      order: [['created_at', 'DESC']],
    });
    return loans;
  }

  async getLoanById(loanId, employeeId) {
    const loan = await Loan.findOne({
      where: { id: loanId },
      include: [{
        model: LoanPayment,
        as: 'payments',
        order: [['paid_on', 'DESC']],
      }],
    });

    if (!loan) {
      throw new AppError('Loan not found', 404);
    }

    // Non-admin can only view their own loans
    const employee = await Employee.findByPk(employeeId);
    if (employee.role !== 'admin' && employee.role !== 'hr' && loan.employee_id !== employeeId) {
      throw new AppError('You can only view your own loans', 403);
    }

    return loan;
  }

  async getLoanByIdAdmin(loanId) {
    const loan = await Loan.findOne({
      where: { id: loanId },
      include: [
        {
          model: LoanPayment,
          as: 'payments',
          order: [['paid_on', 'DESC']],
        },
        {
          model: Employee,
          as: 'employee',
          attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'profile_image'],
          include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
        },
      ],
    });

    if (!loan) {
      throw new AppError('Loan not found', 404);
    }

    return loan;
  }

  async getLoanPayments(loanId, employeeId) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) throw new AppError('Loan not found', 404);

    const employee = await Employee.findByPk(employeeId);
    if (employee.role !== 'admin' && employee.role !== 'hr' && loan.employee_id !== employeeId) {
      throw new AppError('Access denied', 403);
    }

    const payments = await LoanPayment.findAll({
      where: { loan_id: loanId },
      order: [['paid_on', 'DESC']],
    });

    return payments;
  }

  async applyLoan(employeeId, loanData, approvedBy = null) {
    if (!approvedBy) {
      const emp = await Employee.findByPk(employeeId, { attributes: ['id', 'is_loans_allowed'] });
      if (emp && emp.is_loans_allowed === false) {
        throw new AppError('Loan applications are currently disabled for your account by administration. Please contact your HR manager.', 403);
      }
    }

    const { type, principal_amount, interest_rate, tenure_months, reason } = loanData;

    if (principal_amount > 50000) {
      throw new AppError('Loan amount cannot exceed ₹50,000', 400);
    }

    // Calculate EMI
    const emiAmount = this._calculateEMI(principal_amount, interest_rate, tenure_months);

    const status = approvedBy ? 'active' : 'pending';
    const disbursed_on = approvedBy ? new Date() : null;

    const loan = await Loan.create({
      employee_id: employeeId,
      type,
      principal_amount,
      interest_rate,
      tenure_months,
      emi_amount: emiAmount,
      total_remaining: principal_amount,
      paid_percentage: 0,
      status,
      disbursed_on,
      approved_by: approvedBy,
    });

    logger.info(`Employee ${employeeId} applied for ${type} loan of ₹${principal_amount}. Status: ${status}`);
    return loan;
  }

  async getAllLoans({ page = 1, limit = PAGINATION.DEFAULT_LIMIT, status, type } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = {};
    if (status) whereClause.status = status;
    if (type) whereClause.type = type;

    const { rows, count } = await Loan.findAndCountAll({
      where: whereClause,
      include: [{
        model: Employee,
        as: 'employee',
        attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'profile_image'],
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
      }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async approveLoan(loanId, approvedBy) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) throw new AppError('Loan not found', 404);

    if (loan.status !== 'pending') {
      throw new AppError('Only pending loans can be approved', 400);
    }

    await loan.update({
      status: 'active',
      approved_by: approvedBy,
      disbursed_on: new Date(),
    });

    logger.info(`Loan ${loanId} approved by ${approvedBy}`);
    return loan;
  }

  async rejectLoan(loanId, remarks, rejectedBy) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) throw new AppError('Loan not found', 404);

    if (loan.status !== 'pending') {
      throw new AppError('Only pending loans can be rejected', 400);
    }

    await loan.update({
      status: 'rejected',
      approved_by: rejectedBy,
    });

    logger.info(`Loan ${loanId} rejected by ${rejectedBy}`);
    return loan;
  }

  async recordLoanPayment(loanId, paymentData) {
    const loan = await Loan.findByPk(loanId);
    if (!loan) throw new AppError('Loan not found', 404);

    if (loan.status !== 'active') {
      throw new AppError('Only active loans can receive payments', 400);
    }

    const { amount, month } = paymentData;
    const interestPart = loan.total_remaining * (loan.interest_rate / 100 / 12);
    const principalPart = amount - interestPart;

    const payment = await LoanPayment.create({
      loan_id: loanId,
      amount,
      principal_part: principalPart,
      interest_part: interestPart,
      paid_on: new Date(),
      month,
      status: 'paid',
    });

    const newRemaining = loan.total_remaining - principalPart;
    const paidPercentage = Math.round(((loan.principal_amount - newRemaining) / loan.principal_amount) * 100);

    await loan.update({
      total_remaining: newRemaining,
      paid_percentage: paidPercentage,
    });

    // If fully paid, mark as closed
    if (newRemaining <= 0) {
      await loan.update({ status: 'closed' });
    }

    logger.info(`Payment of ₹${amount} recorded for loan ${loanId}`);
    return payment;
  }

  // Private: Calculate EMI using formula: EMI = P × r × (1+r)^n / ((1+r)^n - 1)
  _calculateEMI(principal, annualRate, tenureMonths) {
    const monthlyRate = annualRate / 100 / 12;
    if (monthlyRate === 0) return Math.round(principal / tenureMonths);

    const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) /
      (Math.pow(1 + monthlyRate, tenureMonths) - 1);

    return Math.round(emi);
  }
}

module.exports = new LoanService();