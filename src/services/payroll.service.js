const { Payslip, SalaryComponent, Employee, SalaryStructure, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION, PT_SLABS, PAYSLIP_STATUS } = require('../utils/constants');
const { getWeekendDays, getHolidaysInMonth, countWorkingDaysInMonth, countElapsedWorkingDays, getPTSlabs } = require('../utils/payrollHelper');

// ── Salary calculation helpers (50% basic formula & component breakup, Req 2.4) ──

/**
 * Break down fixed gross into basic (50%), optional HRA, allowances, and other components.
 *
 * @param {number} fixedGross   - Employee's fixed gross salary
 * @param {number} workingDays  - Total working / calendar days used as denominator
 * @param {number} absentDays   - LOP days (absent + 0.5 × half_days)
 * @param {number|null} elapsedDays - Days elapsed so far in an ongoing month;
 *                                    when supplied the numerator is capped to
 *                                    min(elapsedDays, workingDays) so the salary
 *                                    is pro-rated up to today for mid-month cycles.
 * @param {object} opts         - Optional allowance & applicability overrides (Req 2.4)
 */
function calcBreakdown(fixedGross, workingDays = 26, absentDays = 0, elapsedDays = null, {
  hraApplicable = true,
  conveyance = 0,
  medicalAllowance = 0,
  specialAllowance = 0,
  performanceAllowance = 0,
} = {}) {
  const D = workingDays || 26;

  // For ongoing months: cap payable days to however many days have elapsed
  const effectiveDays = elapsedDays != null ? Math.min(elapsedDays, D) : D;
  const payableDays = Math.max(0, effectiveDays - (absentDays || 0));

  // 50% Basic Salary (Req 2.4)
  const fixedBasic = Math.round(fixedGross * 0.50);
  const fixedHra = hraApplicable !== false ? Math.round(fixedBasic * 0.40) : 0;
  const fixedConv = Number(conveyance) || 0;
  const fixedMed = Number(medicalAllowance) || 0;
  const fixedSpec = Number(specialAllowance) || 0;
  const fixedPerf = Number(performanceAllowance) || 0;
  const fixedOther = Math.max(0, fixedGross - (fixedBasic + fixedHra + fixedConv + fixedMed + fixedSpec + fixedPerf));

  // Prorate on the full denominator (D) so the rate per-day stays correct
  const basic = Math.round((fixedBasic / D) * payableDays);
  const hra = Math.round((fixedHra / D) * payableDays);
  const conv = Math.round((fixedConv / D) * payableDays);
  const med = Math.round((fixedMed / D) * payableDays);
  const spec = Math.round((fixedSpec / D) * payableDays);
  const perf = Math.round((fixedPerf / D) * payableDays);
  const other = Math.round((fixedOther / D) * payableDays);

  return {
    fixedBasic, fixedHra, fixedConv, fixedMed, fixedSpec, fixedPerf, fixedOther,
    basic, hra, conveyance: conv, medicalAllowance: med, special: spec, performance: perf, other,
    payableDays, effectiveDays
  };
}

function calcStatutory(proratedGross, basic, basicForPf, pfApplicable, esicApplicable, {
  pfContributionMode = 'shared',
  esicContributionMode = 'shared',
  pfEmployeeRate = 0.12,
  pfEmployerRate = 0.12,
  esicEmployeeRate = 0.0075,
  esicEmployerRate = 0.0325,
} = {}) {
  // ── PF: respect contribution mode ──
  let pfEmployee = 0;
  let pfEmployer = 0;
  if (pfApplicable) {
    switch (pfContributionMode) {
      case 'employee_only':
        pfEmployee = Math.round(basicForPf * pfEmployeeRate);
        pfEmployer = 0;
        break;
      case 'employer_only':
        pfEmployee = 0;
        pfEmployer = Math.round(basicForPf * pfEmployerRate);
        break;
      case 'shared':
        pfEmployee = Math.round(basicForPf * pfEmployeeRate);
        pfEmployer = Math.round(basicForPf * pfEmployerRate);
        break;
      case 'none':
      default:
        pfEmployee = 0;
        pfEmployer = 0;
        break;
    }
  }

  // ── ESIC: respect contribution mode ──
  let esiEmployee = 0;
  let esiEmployer = 0;
  if (esicApplicable) {
    switch (esicContributionMode) {
      case 'shared':
        esiEmployee = Math.ceil(proratedGross * esicEmployeeRate);
        esiEmployer = Math.ceil(proratedGross * esicEmployerRate);
        break;
      case 'none':
      default:
        esiEmployee = 0;
        esiEmployer = 0;
        break;
    }
  }

  return { pfEmployee, pfEmployer, esiEmployee, esiEmployer };
}

function calcPT(proratedGross, slabs) {
  const activeSlabs = slabs || PT_SLABS;
  for (const slab of activeSlabs) {
    const toVal = slab.to === null || slab.to === undefined ? Infinity : slab.to;
    if (proratedGross >= slab.from && proratedGross <= toVal) {
      return slab.amount;
    }
  }
  return 0;
}

// calcElapsedDaysForEmployee removed as countElapsedWorkingDays now handles Dates natively
class PayrollService {
  // ── Read ──────────────────────────────────────────────────────────

  async getPayslips(employeeId, { page = 1, limit = PAGINATION.DEFAULT_LIMIT, year } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = { employee_id: employeeId };
    if (year) whereClause.year = year;

    const { rows, count } = await Payslip.findAndCountAll({
      where: whereClause,
      include: [{
        model: SalaryComponent,
        as: 'components',
      }],
      order: [['year', 'DESC'], ['month_index', 'DESC']],
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

  async getPayslipById(payslipId, employeeId) {
    const payslip = await Payslip.findOne({
      where: { id: payslipId },
      include: [{
        model: SalaryComponent,
        as: 'components',
      }],
    });

    if (!payslip) {
      throw new AppError('Payslip not found', 404);
    }

    // Non-admin employees can only view their own payslips
    const employee = await Employee.findByPk(employeeId);
    if (employee.role !== 'admin' && employee.role !== 'hr' && payslip.employee_id !== employeeId) {
      throw new AppError('You can only view your own payslips', 403);
    }

    return payslip;
  }

  async getCurrentPayslip(employeeId) {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-indexed
    const currentYear = now.getFullYear();

    const payslip = await Payslip.findOne({
      where: {
        employee_id: employeeId,
        month_index: currentMonth,
        year: currentYear,
      },
      include: [{
        model: SalaryComponent,
        as: 'components',
      }],
    });

    if (!payslip) {
      throw new AppError('Current month payslip not yet generated', 404);
    }

    return payslip;
  }

  // ── Generation — full component breakdown ─────────────────────────

  /**
   * Generate payslips for given employees.
   * For each employee:
   *  1. Reads fixed_gross from Employee (fallback to latest SalaryStructure)
   *  2. Breaks down via 40 % formula → basic / hra / other
   *  3. Calculates prorated amounts based on working_days – absent_days
   *  4. Computes PF, ESI (employee & employer), PT (slab lookup), CTC
   *  5. Creates Payslip row + SalaryComponent rows
   */
  async generatePayslips(month, year, employeeIds) {
    const monthIndex = month - 1; // Convert to 0-indexed
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Detect whether this is the current (ongoing) month
    const now = new Date();
    const isCurrentMonth = (now.getFullYear() === Number(year) && now.getMonth() === monthIndex);

    // ── Fetch dynamic weekend policy & holidays for this month ──
    const weekendDays = await getWeekendDays();
    const holidays = await getHolidaysInMonth(year, month);
    const ptSlabs = await getPTSlabs();

    // Total working days in the month (excluding weekends & holidays)
    const dynamicWorkingDays = countWorkingDaysInMonth(year, month, weekendDays, holidays);

    // For current month, salary is earned only up to today's working days
    const elapsedWorkingDays = isCurrentMonth
      ? countElapsedWorkingDays(year, month, now, null, weekendDays, holidays)
      : null;

    // Fetch employees
    const whereClause = { status: 'active', role: { [Op.ne]: 'admin' } };
    if (employeeIds && employeeIds.length > 0) {
      whereClause.id = { [Op.in]: employeeIds };
    }

    const employees = await Employee.findAll({ where: whereClause });

    if (employees.length === 0) {
      logger.info('No active employees found for payslip generation');
      return { count: 0, payslips: [] };
    }

    // Fetch latest SalaryStructure for all employees in one query
    const empIds = employees.map(e => e.id);
    const structures = await SalaryStructure.findAll({
      where: { employee_id: { [Op.in]: empIds } },
      order: [['effective_from', 'DESC']],
    });

    // Build a map: employee_id → latest SalaryStructure
    const structureMap = {};
    for (const s of structures) {
      if (!structureMap[s.employee_id]) {
        structureMap[s.employee_id] = s;
      }
    }

    // Pre-fetch all MonthlyAttendance rows for this month in one query
    const { MonthlyAttendance } = require('../models');
    const allMonthlyStats = await MonthlyAttendance.findAll({
      where: { month: month, year: year },
    });
    const monthlyMap = new Map(allMonthlyStats.map(m => [m.employee_id, m]));

    const payslips = [];

    for (const emp of employees) {
      // Check if payslip already exists for this month/year
      const existing = await Payslip.findOne({
        where: {
          employee_id: emp.id,
          month_index: monthIndex,
          year,
        },
      });

      if (existing) continue; // Skip if already generated

      const str = structureMap[emp.id];

      // Determine salary config — prefer SalaryStructure, fallback to Employee fields
      const fixedGross = Number(str?.fixed_gross || emp.fixed_gross) || 0;
      const pfApplicable = str ? str.pf_applicable : (emp.pf_applicable || false);
      const pfCeiling = str ? str.pf_ceiling : (emp.pf_ceiling || false);
      const esicApplicable = str ? str.esic_applicable : (emp.esic_applicable || false);
      const ptApplicable = str ? (str.pt_applicable !== false) : true;

      // ── Contribution modes & rates (Phase 8) ──
      const pfContributionMode = str?.pf_contribution_mode || emp.pf_contribution_mode || 'shared';
      const esicContributionMode = str?.esic_contribution_mode || emp.esic_contribution_mode || 'shared';
      const pfEmployeeRate = Number(str?.pf_employee_rate ?? 0.12);
      const pfEmployerRate = Number(str?.pf_employer_rate ?? 0.12);
      const esicEmployeeRate = Number(str?.esic_employee_rate ?? 0.0075);
      const esicEmployerRate = Number(str?.esic_employer_rate ?? 0.0325);

      // Working days — dynamically computed from weekend policy + holidays
      const workingDays = dynamicWorkingDays;

      // Absent/LOP days from MonthlyAttendance (source of truth)
      const monthly = monthlyMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : 0;

      // Elapsed days — respect joining date for mid-month joiners
      let empElapsedWorkingDays = null;
      if (isCurrentMonth) {
        empElapsedWorkingDays = countElapsedWorkingDays(year, month, now, emp.date_of_joining, weekendDays, holidays);
        if (empElapsedWorkingDays === 0) {
          logger.info(`Skipping payslip for employee ${emp.id} (${emp.name}) — joining date is in the future or no elapsed days`);
          continue;
        }
      } else {
        const cycleEnd = new Date(year, month - 1, 25);
        if (emp.date_of_joining && new Date(emp.date_of_joining) > cycleEnd) {
          continue;
        }
      }

      // ── 50% formula breakdown & allowance components (Req 2.4) ──
      const breakdown = calcBreakdown(fixedGross, workingDays, absentDays, empElapsedWorkingDays, {
        hraApplicable: str ? str.hra_applicable : (emp.hra_applicable !== false),
        conveyance: str?.conveyance || 0,
        medicalAllowance: str?.medical_allowance || 0,
        specialAllowance: str?.special_allowance || 0,
        performanceAllowance: str?.performance_allowance || emp.performance_allowance || 0,
      });
      const proratedGross = breakdown.basic + breakdown.hra + breakdown.conveyance + breakdown.medicalAllowance + breakdown.special + breakdown.performance + breakdown.other;

      const conveyance = breakdown.conveyance;
      const medicalAllowance = breakdown.medicalAllowance;
      const specialAllowance = breakdown.special;
      const performanceAllowance = breakdown.performance;

      const totalEarnings = proratedGross;

      // ── PF base (apply ceiling if enabled) ──
      const pfBase = pfCeiling ? Math.min(breakdown.basic, 15000) : breakdown.basic;

      // ── Statutory deductions (Phase 8: contribution modes) ──
      const { pfEmployee, pfEmployer, esiEmployee, esiEmployer } =
        calcStatutory(totalEarnings, breakdown.basic, pfBase, pfApplicable, esicApplicable, {
          pfContributionMode,
          esicContributionMode,
          pfEmployeeRate,
          pfEmployerRate,
          esicEmployeeRate,
          esicEmployerRate,
        });

      // ── PT (slab lookup) ──
      const professionalTax = ptApplicable ? calcPT(proratedGross, ptSlabs) : 0;

      // ── Loan EMI Deductions ──
      const { Loan, LoanPayment } = require('../models');
      const activeLoans = await Loan.findAll({ where: { employee_id: emp.id, status: 'active' } });
      let totalLoanDeduction = 0;
      const loanDeductionsList = [];

      for (const loan of activeLoans) {
        const emiToDeduct = Math.min(Number(loan.emi_amount), Number(loan.total_remaining));
        if (emiToDeduct > 0) {
          totalLoanDeduction += emiToDeduct;
          loanDeductionsList.push({
            loan,
            amount: emiToDeduct
          });
        }
      }

      // ── Totals ──
      const totalDeductions = pfEmployee + esiEmployee + professionalTax + totalLoanDeduction;
      const netSalary = totalEarnings - totalDeductions;

      // ── CTC ──
      const ctc = totalEarnings + pfEmployer + esiEmployer;
      const annualCtc = ctc * 12;

      // ── Create payslip ──
      const payslip = await Payslip.create({
        employee_id: emp.id,
        month: monthNames[monthIndex],
        month_index: monthIndex,
        year,
        basic_salary: breakdown.basic,
        gross_salary: totalEarnings,
        net_salary: netSalary,
        total_deductions: totalDeductions,
        pf_employee: pfEmployee,
        pf_employer: pfEmployer,
        esi_employee: esiEmployee,
        esi_employer: esiEmployer,
        professional_tax: professionalTax,
        hra: breakdown.hra,
        special_allowance: specialAllowance,
        performance_allowance: performanceAllowance,
        other_allowance: breakdown.other,
        conveyance,
        medical_allowance: medicalAllowance,
        // For ongoing months, working_days reflects days elapsed (not full month)
        working_days: breakdown.effectiveDays ?? workingDays,
        paid_days: breakdown.payableDays,
        lop_days: absentDays,
        ctc,
        annual_ctc: annualCtc,
        status: PAYSLIP_STATUS.PROCESSED,
      });

      // ── Create salary components ──
      const components = [
        { payslip_id: payslip.id, name: 'Basic Salary (50%)', type: 'earning', amount: breakdown.basic, category: 'basic' },
        { payslip_id: payslip.id, name: 'HRA', type: 'earning', amount: breakdown.hra, category: 'allowance' },
        { payslip_id: payslip.id, name: 'Other Allowance', type: 'earning', amount: breakdown.other, category: 'allowance' },
      ];

      if (specialAllowance > 0) {
        components.push({ payslip_id: payslip.id, name: 'Special Allowance', type: 'earning', amount: specialAllowance, category: 'allowance' });
      }
      if (performanceAllowance > 0) {
        components.push({ payslip_id: payslip.id, name: 'Performance Allowance', type: 'earning', amount: performanceAllowance, category: 'allowance' });
      }
      if (conveyance > 0) {
        components.push({ payslip_id: payslip.id, name: 'Conveyance Allowance', type: 'earning', amount: conveyance, category: 'allowance' });
      }
      if (medicalAllowance > 0) {
        components.push({ payslip_id: payslip.id, name: 'Medical Allowance', type: 'earning', amount: medicalAllowance, category: 'allowance' });
      }

      components.push(
        { payslip_id: payslip.id, name: 'PF (Employee Contribution)', type: 'deduction', amount: pfEmployee, category: 'statutory' },
        { payslip_id: payslip.id, name: 'PF (Employer Contribution)', type: 'deduction', amount: pfEmployer, category: 'statutory' },
        { payslip_id: payslip.id, name: 'ESI (Employee)', type: 'deduction', amount: esiEmployee, category: 'statutory' },
        { payslip_id: payslip.id, name: 'ESI (Employer)', type: 'deduction', amount: esiEmployer, category: 'statutory' },
        { payslip_id: payslip.id, name: 'Professional Tax', type: 'deduction', amount: professionalTax, category: 'statutory' },
      );

      // Process loan updates & add loan components
      for (const ld of loanDeductionsList) {
        const { loan, amount } = ld;
        const interestPart = Math.round(Number(loan.total_remaining) * (Number(loan.interest_rate) / 100 / 12));
        const principalPart = Math.max(0, amount - interestPart);

        // Update loan balance
        const newRemaining = Math.max(0, loan.total_remaining - principalPart);
        const paidPercentage = Math.round(((loan.principal_amount - newRemaining) / loan.principal_amount) * 100);

        await loan.update({
          total_remaining: newRemaining,
          paid_percentage: paidPercentage,
          status: newRemaining <= 0 ? 'closed' : 'active'
        });

        // Record payment
        await LoanPayment.create({
          loan_id: loan.id,
          amount,
          principal_part: principalPart,
          interest_part: interestPart,
          paid_on: new Date(),
          month: `${monthNames[monthIndex]} ${year}`,
          status: 'paid'
        });

        // Add to components
        components.push({
          payslip_id: payslip.id,
          name: `Loan EMI - ${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)}`,
          type: 'deduction',
          amount,
          category: 'loan'
        });
      }

      await SalaryComponent.bulkCreate(components);
      payslips.push(payslip);
    }

    logger.info(`Generated ${payslips.length} payslips for ${monthNames[monthIndex]} ${year}`);
    return { count: payslips.length, payslips };
  }

  // ── Status updates ────────────────────────────────────────────────

  async markPayslipPaid(payslipId) {
    const payslip = await Payslip.findByPk(payslipId);
    if (!payslip) {
      throw new AppError('Payslip not found', 404);
    }

    if (payslip.status === PAYSLIP_STATUS.PAID) {
      throw new AppError('Payslip is already marked as paid', 400);
    }

    await payslip.update({
      status: PAYSLIP_STATUS.PAID,
      paid_on: new Date(),
    });

    logger.info(`Payslip ${payslipId} marked as paid`);
    return payslip;
  }
}

module.exports = new PayrollService();