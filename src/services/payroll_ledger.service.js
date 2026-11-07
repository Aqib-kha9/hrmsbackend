const { PayrollCycle, PayrollEntry, Employee, SalaryStructure, Office, Company, Payslip, SalaryComponent, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION, PT_SLABS } = require('../utils/constants');
const { getWeekendDays, getHolidaysInMonth, countWorkingDaysInMonth, countElapsedWorkingDays, getPTSlabs } = require('../utils/payrollHelper');
const notificationService = require('./notification.service');
const payslipPdfService = require('./payslip_pdf.service');
const emailService = require('./email.service');

/**
 * Payroll ledger service — mirrors the frontend's calculateProductionNet() logic.
 *
 * Frontend shape per row:
 *   { id, employeeCode, name, location, company, designation,
 *     fixedGross, pfApplicable, pfCeiling, esicApplicable,
 *     absentDays, bonus, previousArrears, incentive,
 *     loanDeduction, otherDeduction, status }
 *
 * Calculation (exact match with frontend):
 *   fixedBasic = round(fixedGross * 0.40)
 *   fixedHra   = round(fixedBasic * 0.40)
 *   fixedOther = fixedGross - fixedBasic - fixedHra
 *   basic  = round((fixedBasic  / DAYS) * payableDays)
 *   hra    = round((fixedHra    / DAYS) * payableDays)
 *   other  = round((fixedOther  / DAYS) * payableDays)
 *   totalEarnings = proratedGross + arrears + bonus + incentive
 *   PF = pfApplicable ? (pfCeiling ? min(basic, 15000) : basic) * 0.12 : 0
 *   ESI = esicApplicable ? ceil(totalEarnings * 0.0075) : 0
 *   PT  = slab-based
 *   net = totalEarnings - deductions
 */
class PayrollLedgerService {

  /**
   * Compute the dynamic working days denominator for a given month/year.
   * Cached per instance so multiple calls in the same request reuse the result.
   */
  async _getDynamicDaysInMonth(month, year) {
    const cacheKey = `${year}-${month}`;
    if (!this._daysCache) this._daysCache = {};
    if (this._daysCache[cacheKey] != null) return this._daysCache[cacheKey];

    const weekendDays = await getWeekendDays();
    const holidays = await getHolidaysInMonth(year, month);
    const workingDays = countWorkingDaysInMonth(year, month, weekendDays, holidays);

    this._daysCache[cacheKey] = { workingDays, weekendDays, holidays };
    return this._daysCache[cacheKey];
  }

  // ── Calculation helpers (mirror frontend calculateProductionNet) ──

  _calculateRow(row, daysInMonth = 28, slabs) {
    const D = daysInMonth;
    const elapsedDays = row._elapsedDays != null ? Math.min(row._elapsedDays, D) : D;

    // Administrative Control & Manual Leave Adjustment (Req 4.1 & 4.2)
    const rawAbsent = Number(row.absent_days || 0);
    const leaveAdjust = Number(row.leave_adjustment_days || 0);
    const carryForward = Number(row.leave_carry_forward_days || 0);

    // Effective absent days deducted this cycle
    const effectiveAbsentDays = Math.max(0, rawAbsent + leaveAdjust - carryForward);

    // If Admin explicitly set manual_payable_days, respect it directly; else compute from effective absent days
    const payableDays = (row.manual_payable_days !== null && row.manual_payable_days !== undefined && !isNaN(Number(row.manual_payable_days)))
      ? Math.max(0, Math.min(D, Number(row.manual_payable_days)))
      : Math.max(0, elapsedDays - effectiveAbsentDays);

    const fixedGross = Number(row.fixed_gross) || 0;

    const fixedBasic = Math.round(fixedGross * 0.40);
    const fixedHra = Math.round(fixedBasic * 0.40);
    const fixedOther = fixedGross - fixedBasic - fixedHra;

    const basic = Math.round((fixedBasic / D) * payableDays);
    const hra = Math.round((fixedHra / D) * payableDays);
    const other = Math.round((fixedOther / D) * payableDays);
    const proratedGross = basic + hra + other;

    const totalEarnings = proratedGross
      + (Number(row.previous_arrears) || 0)
      + (Number(row.bonus) || 0)
      + (Number(row.incentive) || 0);

    // ── Contribution modes & rates (Phase 8) ──
    const pfContributionMode = row.pf_contribution_mode || 'shared';
    const esicContributionMode = row.esic_contribution_mode || 'shared';
    const pfEmployeeRate = Number(row.pf_employee_rate ?? 0.12);
    const pfEmployerRate = Number(row.pf_employer_rate ?? 0.12);
    const esicEmployeeRate = Number(row.esic_employee_rate ?? 0.0075);
    const esicEmployerRate = Number(row.esic_employer_rate ?? 0.0325);

    // ── PF: respect contribution mode ──
    let pf = 0;
    let pfEmployer = 0;
    if (row.pf_applicable) {
      const pfBase = row.pf_ceiling ? Math.min(basic, 15000) : basic;
      switch (pfContributionMode) {
        case 'employee_only':
          pf = Math.round(pfBase * pfEmployeeRate);
          pfEmployer = 0;
          break;
        case 'employer_only':
          pf = 0;
          pfEmployer = Math.round(pfBase * pfEmployerRate);
          break;
        case 'shared':
          pf = Math.round(pfBase * pfEmployeeRate);
          pfEmployer = Math.round(pfBase * pfEmployerRate);
          break;
        case 'none':
        default:
          pf = 0;
          pfEmployer = 0;
          break;
      }
    }

    // ── ESIC: respect contribution mode ──
    let esi = 0;
    let esiEmployer = 0;
    if (row.esic_applicable) {
      switch (esicContributionMode) {
        case 'shared':
          esi = Math.ceil(totalEarnings * esicEmployeeRate);
          esiEmployer = Math.ceil(totalEarnings * esicEmployerRate);
          break;
        case 'none':
        default:
          esi = 0;
          esiEmployer = 0;
          break;
      }
    }

    // PT — lookup from settings
    let pt = 0;
    if (row.pt_applicable !== false) {
      const activeSlabs = slabs || PT_SLABS;
      for (const slab of activeSlabs) {
        const toVal = slab.to === null || slab.to === undefined ? Infinity : slab.to;
        if (proratedGross >= slab.from && proratedGross <= toVal) {
          pt = slab.amount;
          break;
        }
      }
    }

    const grossDeductions = pf + esi + pt
      + (Number(row.loan_deduction) || 0)
      + (Number(row.other_deduction) || 0);
    const net = totalEarnings - grossDeductions;

    const totalMonthlyCTC = totalEarnings + pfEmployer + esiEmployer;

    return {
      fixedGross, fixedBasic, fixedHra, fixedOther,
      basic, hra, other, proratedGross, totalEarnings,
      payableDays,
      effectiveAbsentDays,
      leaveAdjustmentDays: leaveAdjust,
      leaveCarryForwardDays: carryForward,
      manualPayableDays: (row.manual_payable_days !== null && row.manual_payable_days !== undefined && !isNaN(Number(row.manual_payable_days))) ? Number(row.manual_payable_days) : null,
      lop: fixedGross - proratedGross,
      pf, esi, pt, grossDeductions, net,
      pfEmployer, esiEmployer, totalMonthlyCTC,
    };
  }

  // ── API: GET /payroll/ledger — current-cycle ledger rows ──

  async getCurrentLedger() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // ── Dynamic working days for the current month ──
    const { workingDays: dynamicDays, weekendDays, holidays } =
      await this._getDynamicDaysInMonth(currentMonth + 1, currentYear);
    const elapsedWorkingDays = countElapsedWorkingDays(currentYear, currentMonth + 1, now, null, weekendDays, holidays);

    const ptSlabs = await getPTSlabs();

    let cycle = await PayrollCycle.findOne({
      where: { month_index: currentMonth, year: currentYear },
      include: [{
        model: PayrollEntry,
        as: 'entries',
        include: [{ model: Employee, as: 'employee', include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }, { model: SalaryStructure, as: 'salaryStructures' }] }],
      }],
    });

    if (!cycle) {
      // Auto-create the cycle if it doesn't exist
      cycle = await this._createCycleForMonth(currentMonth, currentYear);
      if (!cycle) {
        return { cycle: null, rows: [] };
      }
      // Re-fetch with entries
      cycle = await PayrollCycle.findOne({
        where: { month_index: currentMonth, year: currentYear },
        include: [{
          model: PayrollEntry,
          as: 'entries',
          include: [{ model: Employee, as: 'employee', include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }, { model: SalaryStructure, as: 'salaryStructures' }] }],
        }],
      });
    }

    // Sync absent days from MonthlyAttendance (source of truth) + add elapsed-day pro-rating
    const { MonthlyAttendance, Loan, LeaveRequest } = require('../models');
    const monthlyStats = await MonthlyAttendance.findAll({
      where: { month: currentMonth + 1, year: currentYear },
    });
    const monthlyMap = new Map(monthlyStats.map(m => [m.employee_id, m]));

    // Pre-fetch leaves overlapping this cycle period to provide transparency in payroll (Req 10)
    const prevMonthForCycle = currentMonth === 0 ? 12 : currentMonth;
    const prevYearForCycle = currentMonth === 0 ? currentYear - 1 : currentYear;
    const cycleStartStr = `${prevYearForCycle}-${String(prevMonthForCycle).padStart(2, '0')}-26`;
    const cycleEndStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-25`;

    const cycleLeaves = await LeaveRequest.findAll({
      where: {
        from_date: { [Op.lte]: cycleEndStr },
        to_date: { [Op.gte]: cycleStartStr },
      },
    });
    const cycleLeaveMap = new Map();
    cycleLeaves.forEach(l => {
      if (!cycleLeaveMap.has(l.employee_id)) cycleLeaveMap.set(l.employee_id, []);
      cycleLeaveMap.get(l.employee_id).push(l);
    });

    // Sync active loan EMIs
    const activeLoans = await Loan.findAll({ where: { status: 'active' } });
    const loanMap = new Map();
    activeLoans.forEach(loan => {
      const currentEmi = loanMap.get(loan.employee_id) || 0;
      loanMap.set(loan.employee_id, currentEmi + Number(loan.emi_amount));
    });

    const rows = (cycle.entries || []).map(entry => {
      const emp = entry.employee;
      const monthly = monthlyMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : (entry.absent_days || 0);

      // Prefer auto-synced loan deduction, fallback to manual entry
      const syncedLoan = loanMap.get(emp.id);
      const loanDeduction = syncedLoan !== undefined ? syncedLoan : (Number(entry.loan_deduction) || 0);

      const activeStructure = emp.salaryStructures?.find(s => s.status === 'active');
      const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : true;

      const baseData = {
        ...emp.toJSON(),
        ...entry.toJSON(),
        loan_deduction: loanDeduction,
        fixed_gross: emp.fixed_gross,
        pf_applicable: emp.pf_applicable,
        pf_ceiling: emp.pf_ceiling,
        esic_applicable: emp.esic_applicable,
        pt_applicable: ptApplicable,
        absent_days: absentDays,
        cycle_leaves: cycleLeaveMap.get(emp.id) || [],
      };

      // 1. Prorated calculation (Till Today)
      const calculation = this._calculateRow({
        ...baseData,
        _elapsedDays: elapsedWorkingDays,
      }, dynamicDays, ptSlabs);

      // 2. Projected calculation (Full Month Cost assuming no more absences)
      // For projected, we assume they work all remaining days, so elapsedDays = D.
      // The only deduction to payable days is the already recorded absentDays.
      const projectedCalculation = this._calculateRow({
        ...baseData,
        _elapsedDays: dynamicDays, // full month elapsed
      }, dynamicDays, ptSlabs);

      // We inject projectedFullMonthCTC and dailyCost directly from the backend
      const projectedMonthly = projectedCalculation.totalMonthlyCTC;
      const dailyCost = Math.round(projectedMonthly / dynamicDays);
      const payableDays = Math.max(0, elapsedWorkingDays - absentDays);

      return {
        id: entry.id,
        employeeId: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        location: emp.location || emp.office?.name || 'Unknown',
        company: emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
        designation: emp.designation || '',
        fixedGross: Number(emp.fixed_gross) || 0,
        pfApplicable: emp.pf_applicable || false,
        pfCeiling: emp.pf_ceiling || false,
        esicApplicable: emp.esic_applicable || false,
        absentDays,
        bonus: Number(entry.bonus) || 0,
        previousArrears: Number(entry.previous_arrears) || 0,
        incentive: Number(entry.incentive) || 0,
        loanDeduction: loanDeduction,
        otherDeduction: Number(entry.other_deduction) || 0,
        status: entry.status || cycle.status || 'Draft',
        elapsedDays: elapsedWorkingDays,
        dynamicDays,
        payableDays,
        dailyCost,
        projectedMonthly,
        uan: emp.uan || '--',
        department: emp.department || '--',
        pfNumber: emp.pf_number || '--',
        bankName: emp.bank_name || '--',
        bankAccountNumber: emp.bank_account_number || '--',
        workingDays: Math.max(0, dynamicDays - absentDays),
        leaveAdjustmentDays: Number(entry.leave_adjustment_days) || 0,
        leave_adjustment_days: Number(entry.leave_adjustment_days) || 0,
        leaveCarryForwardDays: Number(entry.leave_carry_forward_days) || 0,
        leave_carry_forward_days: Number(entry.leave_carry_forward_days) || 0,
        manualPayableDays: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
        manual_payable_days: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
        adminNotes: entry.admin_notes || '',
        admin_notes: entry.admin_notes || '',
        totalMusterDays: entry.total_muster_days || dynamicDays,
        total_muster_days: entry.total_muster_days || dynamicDays,
        presentDays: Number(entry.present_days) || calculation.payableDays,
        present_days: Number(entry.present_days) || calculation.payableDays,
        paidLeaveDays: Number(entry.paid_leave_days) || 0,
        paid_leave_days: Number(entry.paid_leave_days) || 0,
        lwpDays: calculation.effectiveAbsentDays !== undefined ? calculation.effectiveAbsentDays : (entry.lwp_days ? Number(entry.lwp_days) : absentDays),
        lwp_days: calculation.effectiveAbsentDays !== undefined ? calculation.effectiveAbsentDays : (entry.lwp_days ? Number(entry.lwp_days) : absentDays),
        payableDays: calculation.payableDays,
        payable_days: calculation.payableDays,
        ...calculation,
      };
    });

    return {
      cycle: {
        id: cycle.id,
        month: cycle.month,
        month_index: cycle.month_index,
        year: cycle.year,
        status: cycle.status,
        paid_on: cycle.paid_on,
        disbursement_mode: cycle.disbursement_mode,
        disbursement_reference: cycle.disbursement_reference,
        elapsedDays: elapsedWorkingDays,
      },
      rows,
    };
  }

  // ── API: GET /payroll/ledger/:cycleId — specific cycle rows ──

  async getLedgerByCycleId(cycleId) {
    const cycle = await PayrollCycle.findByPk(cycleId, {
      include: [{
        model: PayrollEntry,
        as: 'entries',
        include: [{ model: Employee, as: 'employee', include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }] }],
      }],
    });

    if (!cycle) {
      throw new AppError('Payroll cycle not found', 404);
    }

    // Dynamic working days for the cycle's month (past cycle = full month, no elapsed prorating)
    const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);

    const rows = (cycle.entries || []).map(entry => {
      const emp = entry.employee;
      const calculation = this._calculateRow({
        ...emp.toJSON(),
        ...entry.toJSON(),
        fixed_gross: emp.fixed_gross,
        pf_applicable: emp.pf_applicable,
        pf_ceiling: emp.pf_ceiling,
        esic_applicable: emp.esic_applicable,
      }, dynamicDays);

      return {
        id: entry.id,
        employeeId: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        location: emp.location || emp.office?.name || 'Unknown',
        company: emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
        designation: emp.designation || '',
        fixedGross: Number(emp.fixed_gross) || 0,
        pfApplicable: emp.pf_applicable || false,
        pfCeiling: emp.pf_ceiling || false,
        esicApplicable: emp.esic_applicable || false,
        absentDays: entry.absent_days || 0,
        bonus: Number(entry.bonus) || 0,
        previousArrears: Number(entry.previous_arrears) || 0,
        incentive: Number(entry.incentive) || 0,
        loanDeduction: Number(entry.loan_deduction) || 0,
        otherDeduction: Number(entry.other_deduction) || 0,
        status: entry.status || cycle.status || 'Draft',
        uan: emp.uan || '--',
        department: emp.department || '--',
        pfNumber: emp.pf_number || '--',
        bankName: emp.bank_name || '--',
        bankAccountNumber: emp.bank_account_number || '--',
        workingDays: Math.max(0, dynamicDays - (entry.absent_days || 0)),
        leaveAdjustmentDays: Number(entry.leave_adjustment_days) || 0,
        leave_adjustment_days: Number(entry.leave_adjustment_days) || 0,
        leaveCarryForwardDays: Number(entry.leave_carry_forward_days) || 0,
        leave_carry_forward_days: Number(entry.leave_carry_forward_days) || 0,
        manualPayableDays: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
        manual_payable_days: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
        adminNotes: entry.admin_notes || '',
        admin_notes: entry.admin_notes || '',
        totalMusterDays: entry.total_muster_days || dynamicDays,
        total_muster_days: entry.total_muster_days || dynamicDays,
        presentDays: Number(entry.present_days) || calculation.payableDays,
        present_days: Number(entry.present_days) || calculation.payableDays,
        paidLeaveDays: Number(entry.paid_leave_days) || 0,
        paid_leave_days: Number(entry.paid_leave_days) || 0,
        lwpDays: calculation.effectiveAbsentDays !== undefined ? calculation.effectiveAbsentDays : (entry.lwp_days ? Number(entry.lwp_days) : (entry.absent_days || 0)),
        lwp_days: calculation.effectiveAbsentDays !== undefined ? calculation.effectiveAbsentDays : (entry.lwp_days ? Number(entry.lwp_days) : (entry.absent_days || 0)),
        payableDays: calculation.payableDays,
        payable_days: calculation.payableDays,
        ...calculation,
      };
    });

    return { cycle, rows };
  }

  // ── API: GET /payroll/history — past cycles summary ──

  async getCycleHistory({ page = 1, limit = PAGINATION.DEFAULT_LIMIT, year } = {}) {
    const where = {};
    if (year) where.year = year;

    const { rows, count } = await PayrollCycle.findAndCountAll({
      where,
      include: [{
        model: PayrollEntry,
        as: 'entries',
        include: [{ model: Employee, as: 'employee', include: [{ model: Office, as: 'office' }] }],
      }],
      order: [['year', 'DESC'], ['month_index', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const history = await Promise.all(rows.map(async (cycle) => {
      const entries = cycle.entries || [];
      let totalPayout = 0;
      const branchMap = new Map();

      // Dynamic working days for this cycle's month (past cycle = full month)
      const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);

      for (const entry of entries) {
        const emp = entry.employee;
        if (!emp) continue;
        const calc = this._calculateRow({
          ...emp.toJSON(),
          ...entry.toJSON(),
          fixed_gross: emp.fixed_gross,
          pf_applicable: emp.pf_applicable,
          pf_ceiling: emp.pf_ceiling,
          esic_applicable: emp.esic_applicable,
        }, dynamicDays);
        totalPayout += calc.net;

        const branchName = emp.location || emp.office?.name || 'Unknown';
        if (!branchMap.has(branchName)) {
          branchMap.set(branchName, { name: branchName, payout: 0, staff: 0 });
        }
        const b = branchMap.get(branchName);
        b.payout += calc.net;
        b.staff += 1;
      }

      const branchBreakdown = Array.from(branchMap.values()).map(b => ({
        ...b,
        payout: Math.round(b.payout),
      }));

      const monthName = `${monthNames[cycle.month_index] || cycle.month} ${cycle.year}`;
      const monthId = `${monthNames[cycle.month_index]?.substring(0, 3).toUpperCase() || cycle.month?.substring(0, 3).toUpperCase()}-${cycle.year}`;

      const STATUS_MAP = {
        'Paid': 'Completed',
        'Verified': 'Completed',
        'Draft': 'Processing',
        'Pending Audit': 'Processing',
      };

      const METHOD_MAP = {
        'neft': 'NEFT / RTGS',
        'imps': 'Bulk IMPS',
        'bank_transfer': 'Bank Transfer',
        'cheque': 'Cheque',
      };

      return {
        id: cycle.id,
        monthId,
        monthName,
        month: cycle.month,
        month_index: cycle.month_index,
        year: cycle.year,
        disbursementDate: cycle.paid_on
          ? new Date(cycle.paid_on).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Pending',
        totalPayout: Math.round(totalPayout),
        totalStaff: entries.length,
        branches: branchBreakdown,
        status: STATUS_MAP[cycle.status] || cycle.status || 'Processing',
        method: METHOD_MAP[cycle.disbursement_mode] || cycle.disbursement_mode || 'N/A',
        rawPayout: Math.round(totalPayout),
        paid_on: cycle.paid_on,
        date: cycle.paid_on || null,
      };
    }));

    return {
      data: history,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  async getEmployeeHistory(employeeId, { year } = {}) {
    const where = { employee_id: employeeId };
    const cycleWhere = {};
    if (year) cycleWhere.year = parseInt(year);

    const entries = await PayrollEntry.findAll({
      where,
      include: [{
        model: PayrollCycle,
        as: 'cycle',
        where: Object.keys(cycleWhere).length > 0 ? cycleWhere : undefined,
      }, {
        model: Employee,
        as: 'employee',
        include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }]
      }],
      order: [
        [{ model: PayrollCycle, as: 'cycle' }, 'year', 'DESC'],
        [{ model: PayrollCycle, as: 'cycle' }, 'month_index', 'DESC']
      ]
    });

    const history = await Promise.all(entries.map(async (entry) => {
      const cycle = entry.cycle;
      if (!cycle) return null;
      const emp = entry.employee;
      if (!emp) return null;

      const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);

      const calculation = this._calculateRow({
        ...emp.toJSON(),
        ...entry.toJSON(),
        fixed_gross: emp.fixed_gross,
        pf_applicable: emp.pf_applicable,
        pf_ceiling: emp.pf_ceiling,
        esic_applicable: emp.esic_applicable,
      }, dynamicDays);

      return {
        id: entry.id,
        employeeId: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        cycleId: cycle.id,
        month: cycle.month,
        month_index: cycle.month_index,
        year: cycle.year,
        status: entry.status || cycle.status || 'Draft',
        absentDays: entry.absent_days || 0,
        bonus: Number(entry.bonus) || 0,
        previousArrears: Number(entry.previous_arrears) || 0,
        incentive: Number(entry.incentive) || 0,
        loanDeduction: Number(entry.loan_deduction) || 0,
        otherDeduction: Number(entry.other_deduction) || 0,
        uan: emp.uan || '--',
        designation: emp.designation || '',
        location: emp.location || emp.office?.name || 'Unknown',
        company: emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
        bankName: emp.bank_name || '--',
        bankAccountNumber: emp.bank_account_number || '--',
        pfNumber: emp.pf_number || '--',
        workingDays: Math.max(0, dynamicDays - (entry.absent_days || 0)),
        ...calculation,
      };
    }));

    return history.filter(Boolean);
  }

  // ── API: PATCH /payroll/entry/:entryId — update a single entry ──

  async updateEntry(entryId, data) {
    const entry = await PayrollEntry.findByPk(entryId, {
      include: [
        { model: PayrollCycle, as: 'cycle' },
        { model: Employee, as: 'employee' },
      ],
    });
    if (!entry) throw new AppError('Payroll entry not found', 404);

    const allowed = [
      'absent_days',
      'leave_adjustment_days',
      'leave_carry_forward_days',
      'manual_payable_days',
      'admin_notes',
      'present_days',
      'paid_leave_days',
      'lwp_days',
      'total_muster_days',
      'bonus',
      'previous_arrears',
      'incentive',
      'loan_deduction',
      'other_deduction',
      'status'
    ];
    const updates = {};
    for (const key of allowed) {
      if (data[key] !== undefined) updates[key] = data[key];
    }

    await entry.update(updates);

    // Compute updated row values
    const cycle = entry.cycle;
    const emp = entry.employee;
    let dynamicDays = 30;
    if (cycle) {
      const daysInfo = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);
      dynamicDays = daysInfo.workingDays || 30;
    }
    const ptSlabs = await getPTSlabs();
    const calculation = this._calculateRow({
      ...emp.toJSON(),
      ...entry.toJSON(),
      fixed_gross: emp.fixed_gross,
      pf_applicable: emp.pf_applicable,
      pf_ceiling: emp.pf_ceiling,
      esic_applicable: emp.esic_applicable,
    }, dynamicDays, ptSlabs);

    return {
      ...entry.toJSON(),
      ...calculation,
      leaveAdjustmentDays: Number(entry.leave_adjustment_days) || 0,
      leave_adjustment_days: Number(entry.leave_adjustment_days) || 0,
      leaveCarryForwardDays: Number(entry.leave_carry_forward_days) || 0,
      leave_carry_forward_days: Number(entry.leave_carry_forward_days) || 0,
      manualPayableDays: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
      manual_payable_days: entry.manual_payable_days !== null && entry.manual_payable_days !== undefined ? Number(entry.manual_payable_days) : null,
      adminNotes: entry.admin_notes || '',
      admin_notes: entry.admin_notes || '',
      payableDays: calculation.payableDays,
      payable_days: calculation.payableDays,
      lwpDays: calculation.effectiveAbsentDays,
      lwp_days: calculation.effectiveAbsentDays,
    };
  }

  // ── API: PATCH /payroll/entry/:entryId/status — change status ──

  async updateEntryStatus(entryId, status) {
    const validStatuses = ['Draft', 'Verified', 'Paid', 'Pending Audit'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status: ${status}. Valid: ${validStatuses.join(', ')}`, 400);
    }

    const entry = await PayrollEntry.findByPk(entryId, {
      include: [
        { model: PayrollCycle, as: 'cycle' }
      ]
    });
    if (!entry) throw new AppError('Payroll entry not found', 404);

    const oldStatus = entry.status;
    await entry.update({ status });

    // Trigger Notification if newly marked as Paid
    if (status === 'Paid' && oldStatus !== 'Paid') {
      const cycleText = entry.cycle ? `${entry.cycle.month} ${entry.cycle.year}` : 'the recent cycle';
      await notificationService.createNotification(
        entry.employee_id,
        'Salary Disbursed',
        `Your salary for ${cycleText} has been successfully disbursed.`,
        'success',
        'payroll',
        '/payroll/payslips'
      );
    }

    return entry;
  }

  // ── API: POST /payroll/disburse — disburse the current cycle ──

  async disburseCycle(cycleId, { mode, reference, authorizedBy, remarks, sendEmails = false }) {
    const cycle = await PayrollCycle.findByPk(cycleId);
    if (!cycle) throw new AppError('Payroll cycle not found', 404);

    await cycle.update({
      status: 'Paid',
      paid_on: new Date(),
      disbursement_mode: mode,
      disbursement_reference: reference,
      disbursement_remarks: remarks ? `${remarks} (Authorized By: ${authorizedBy})` : `Authorized By: ${authorizedBy}`,
      paid_by: null,
    });

    // Mark all entries as Paid
    const entries = await PayrollEntry.findAll({
      where: { cycle_id: cycleId },
      include: [
        {
          model: Employee,
          as: 'employee',
          include: [
            { model: Office, as: 'office' },
            { model: Company, as: 'company' },
          ],
        },
      ],
    });

    await PayrollEntry.update(
      { status: 'Paid' },
      { where: { cycle_id: cycleId } },
    );

    // ── Automatic Salary Slip Generation into Payslip Table (Req 3.1 & 3.2) ──
    const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);
    const ptSlabs = await getPTSlabs();

    for (const entry of entries) {
      const emp = entry.employee;
      if (!emp) continue;

      const structure = await SalaryStructure.findOne({
        where: { employee_id: emp.id },
        order: [['effective_from', 'DESC']],
      });

      const row = {
        fixed_gross: structure?.fixed_gross || emp.fixed_gross || 0,
        pf_applicable: structure?.pf_applicable ?? emp.pf_applicable,
        pf_ceiling: structure?.pf_ceiling ?? emp.pf_ceiling,
        pf_contribution_mode: structure?.pf_contribution_mode || emp.pf_contribution_mode,
        pf_employee_rate: structure?.pf_employee_rate ?? 0.12,
        pf_employer_rate: structure?.pf_employer_rate ?? 0.12,
        esic_applicable: structure?.esic_applicable ?? emp.esic_applicable,
        esic_contribution_mode: structure?.esic_contribution_mode || emp.esic_contribution_mode,
        esic_employee_rate: structure?.esic_employee_rate ?? 0.0075,
        esic_employer_rate: structure?.esic_employer_rate ?? 0.0325,
        pt_applicable: structure?.pt_applicable !== false,
        absent_days: entry.absent_days,
        leave_adjustment_days: entry.leave_adjustment_days,
        leave_carry_forward_days: entry.leave_carry_forward_days,
        manual_payable_days: entry.manual_payable_days,
        bonus: entry.bonus,
        previous_arrears: entry.previous_arrears,
        incentive: entry.incentive,
        loan_deduction: entry.loan_deduction,
        other_deduction: entry.other_deduction,
        conveyance: structure?.conveyance || 0,
        medical_allowance: structure?.medical_allowance || 0,
      };

      const calc = this._calculateRow(row, dynamicDays, ptSlabs);

      const musterDays = entry.total_muster_days || dynamicDays;
      const payableDays = calc.payableDays;
      const lopDays = entry.lwp_days !== undefined && entry.lwp_days !== null && Number(entry.lwp_days) > 0
        ? Number(entry.lwp_days)
        : Math.max(0, musterDays - payableDays);

      await Payslip.upsert({
        employee_id: emp.id,
        month: cycle.month,
        month_index: cycle.month_index + 1,
        year: cycle.year,
        basic_salary: calc.basic,
        gross_salary: calc.totalEarnings,
        net_salary: calc.net,
        total_deductions: calc.grossDeductions,
        pf_employee: calc.pf,
        pf_employer: calc.pfEmployer,
        esi_employee: calc.esi,
        esi_employer: calc.esiEmployer,
        professional_tax: calc.pt,
        hra: calc.hra,
        other_allowance: calc.other,
        special_allowance: structure?.special_allowance || 0,
        conveyance: structure?.conveyance || 0,
        medical_allowance: structure?.medical_allowance || 0,
        working_days: musterDays,
        paid_days: payableDays,
        lop_days: lopDays,
        ctc: calc.totalMonthlyCTC,
        status: 'paid',
        paid_on: new Date(),
      }).catch((e) => logger.warn(`Payslip upsert error for emp ${emp.id}: ${e.message}`));
    }

    // Send notifications to all employees in this cycle
    const cycleText = String(cycle.month || '').includes(String(cycle.year)) ? cycle.month : `${cycle.month} ${cycle.year}`;
    for (const entry of entries) {
      await notificationService.createNotification(
        entry.employee_id,
        'Salary Disbursed',
        `Your salary for ${cycleText} has been successfully disbursed. Your salary slip is now ready for download.`,
        'success',
        'payroll',
        '/payroll/payslips'
      ).catch((e) => logger.error(`Failed to send notification for emp ${entry.employee_id}: ${e.message}`));
    }

    // If sendEmails is requested, batch dispatch salary slips
    if (sendEmails) {
      this.sendAllCyclePayslips(cycleId).catch((e) =>
        logger.error(`Automatic payslip email dispatch error for cycle ${cycleId}: ${e.message}`)
      );
    }

    logger.info(`Disbursed payroll cycle ${cycleId} (${cycle.month} ${cycle.year}) and generated all employee payslips`);
    return cycle;
  }

  // ── Automatic Payslip PDF Generation (Req 3.1, 3.2, 3.3) ──

  async generateEntryPayslipPDF(entryId) {
    const entry = await PayrollEntry.findByPk(entryId, {
      include: [
        { model: PayrollCycle, as: 'cycle' },
        {
          model: Employee,
          as: 'employee',
          include: [
            { model: Office, as: 'office' },
            { model: Company, as: 'company' }
          ]
        }
      ]
    });
    if (!entry) throw new AppError('Payroll entry not found', 404);

    const emp = entry.employee;
    const cycle = entry.cycle;
    const structure = await SalaryStructure.findOne({
      where: { employee_id: emp.id },
      order: [['effective_from', 'DESC']]
    });

    const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index, cycle.year);
    const slabs = await getPTSlabs();

    const row = {
      fixed_gross: structure?.fixed_gross || emp.fixed_gross || 0,
      pf_applicable: structure?.pf_applicable ?? emp.pf_applicable,
      pf_ceiling: structure?.pf_ceiling ?? emp.pf_ceiling,
      pf_contribution_mode: structure?.pf_contribution_mode || emp.pf_contribution_mode,
      pf_employee_rate: structure?.pf_employee_rate ?? 0.12,
      pf_employer_rate: structure?.pf_employer_rate ?? 0.12,
      esic_applicable: structure?.esic_applicable ?? emp.esic_applicable,
      esic_contribution_mode: structure?.esic_contribution_mode || emp.esic_contribution_mode,
      esic_employee_rate: structure?.esic_employee_rate ?? 0.0075,
      esic_employer_rate: structure?.esic_employer_rate ?? 0.0325,
      pt_applicable: structure?.pt_applicable !== false,
      absent_days: entry.absent_days,
      leave_adjustment_days: entry.leave_adjustment_days,
      leave_carry_forward_days: entry.leave_carry_forward_days,
      manual_payable_days: entry.manual_payable_days,
      bonus: entry.bonus,
      previous_arrears: entry.previous_arrears,
      incentive: entry.incentive,
      loan_deduction: entry.loan_deduction,
      other_deduction: entry.other_deduction,
      conveyance: structure?.conveyance || 0,
      medical_allowance: structure?.medical_allowance || 0,
    };

    const calc = this._calculateRow(row, dynamicDays, slabs);

    const payslipData = {
      employee_name: emp.name,
      emp_code: emp.emp_code,
      designation: emp.designation,
      department: emp.department,
      location: emp.location || emp.office?.name,
      office_address: emp.office?.address,
      company_name: emp.company_name || emp.company?.name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
      month: cycle.month,
      year: cycle.year,
      uan: emp.uan,
      pf_number: emp.pf_number,
      pan_number: emp.pan_number,
      bank_name: emp.bank_name,
      bank_account_number: emp.bank_account_number,
      // Attendance (Req 3.2)
      total_muster_days: entry.total_muster_days || dynamicDays,
      present_days: entry.present_days !== undefined && entry.present_days !== null && Number(entry.present_days) > 0 ? Number(entry.present_days) : calc.payableDays,
      payable_days: calc.payableDays,
      lwp_days: entry.lwp_days !== undefined && entry.lwp_days !== null && Number(entry.lwp_days) > 0 ? Number(entry.lwp_days) : Math.max(0, dynamicDays - calc.payableDays),
      // Standard / Fixed Structure (Req 3.3)
      fixed_gross: calc.fixedGross,
      fixed_basic: calc.fixedBasic,
      fixed_hra: calc.fixedHra,
      fixed_other: calc.fixedOther,
      // Earnings & Deductions (Req 3.3)
      basic_salary: calc.basic,
      hra: calc.hra,
      other_allowance: calc.other,
      special_allowance: structure?.special_allowance || 0,
      conveyance: structure?.conveyance || 0,
      medical_allowance: structure?.medical_allowance || 0,
      bonus: Number(entry.bonus) || 0,
      incentive: Number(entry.incentive) || 0,
      previous_arrears: Number(entry.previous_arrears) || 0,
      total_earnings: calc.totalEarnings,
      gross_salary: calc.totalEarnings,
      pf_employee: calc.pf,
      esi_employee: calc.esi,
      professional_tax: calc.pt,
      loan_deduction: Number(entry.loan_deduction) || 0,
      other_deduction: Number(entry.other_deduction) || 0,
      total_deductions: calc.grossDeductions,
      net_salary: calc.net,
      pf_employer: calc.pfEmployer,
      esi_employer: calc.esiEmployer,
      ctc: calc.totalMonthlyCTC,
    };

    return await payslipPdfService.generatePayslipPDF(payslipData);
  }

  // ── Send Payslip PDF via Email (Req 3.1) ──

  async sendPayslipEmail(entryId, recipientEmail = null) {
    const entry = await PayrollEntry.findByPk(entryId, {
      include: [
        { model: PayrollCycle, as: 'cycle' },
        { model: Employee, as: 'employee' }
      ]
    });
    if (!entry) throw new AppError('Payroll entry not found', 404);

    const emp = entry.employee;
    const cycle = entry.cycle;
    const targetEmail = recipientEmail || emp.email;
    if (!targetEmail) throw new AppError('No email address registered for this employee', 400);

    const pdfBuffer = await this.generateEntryPayslipPDF(entryId);
    const cycleName = String(cycle.month || '').includes(String(cycle.year)) ? cycle.month : `${cycle.month} ${cycle.year}`;
    const filename = `${emp.name.replace(/\s+/g, '_')}_Payslip_${cycleName.replace(/\s+/g, '_')}.pdf`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff;">
        <div style="background-color: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Salary Slip &mdash; ${cycleName}</h2>
          <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Apaar Logistics & Cold Supply Chain Pvt Ltd</p>
        </div>
        <div style="padding: 24px 8px;">
          <p style="font-size: 15px; color: #334155;">Dear <strong>${emp.name}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Please find attached your official salary slip for <strong>${cycleName}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px; font-size: 13px; color: #64748b;"><strong>Employee ID:</strong> ${emp.emp_code}</p>
            <p style="margin: 0 0 8px; font-size: 13px; color: #64748b;"><strong>Designation:</strong> ${emp.designation || 'N/A'}</p>
            <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Payable Days:</strong> ${entry.manual_payable_days || 'Full Month'}</p>
          </div>
          <p style="font-size: 13px; color: #475569;">
            The PDF document contains your full attendance muster days, payable days, earnings, and statutory deductions.
          </p>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
          This is an automated communication from Apaar Logistics HRMS.
        </div>
      </div>
    `;

    await emailService.sendMail({
      to: targetEmail,
      subject: `Salary Slip for ${cycleName} — ${emp.name}`,
      html,
      attachments: [
        {
          filename,
          content: pdfBuffer,
        }
      ]
    });

    logger.info(`Salary slip emailed to ${targetEmail} for ${emp.emp_code} (${cycleName})`);
    return { success: true, email: targetEmail, filename };
  }

  // ── Batch Send All Payslips for a Cycle (Req 3.1) ──

  async sendAllCyclePayslips(cycleId) {
    const entries = await PayrollEntry.findAll({
      where: { cycle_id: cycleId },
      include: [{ model: Employee, as: 'employee' }]
    });

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const entry of entries) {
      if (!entry.employee || !entry.employee.email) continue;
      try {
        await this.sendPayslipEmail(entry.id);
        sent++;
      } catch (e) {
        failed++;
        errors.push({ employee: entry.employee.emp_code, error: e.message });
        logger.error(`Failed to send payslip to ${entry.employee.emp_code}: ${e.message}`);
      }
    }

    return { total: entries.length, sent, failed, errors };
  }

  // ── Internal: auto-create a cycle for the current month ──

  async _createCycleForMonth(monthIndex, year) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const existing = await PayrollCycle.findOne({ where: { month_index: monthIndex, year } });
    if (existing) return existing;

    const cycle = await PayrollCycle.create({
      month: `${monthNames[monthIndex]} ${year}`,
      month_index: monthIndex,
      year,
      status: 'Draft',
    });

    // Auto-create entries for all active employees (excluding admins)
    const employees = await Employee.findAll({ where: { status: 'active', role: { [Op.ne]: 'admin' } } });
    const { MonthlyAttendance } = require('../models');
    const monthlyStats = await MonthlyAttendance.findAll({
      where: {
        month: monthIndex + 1,
        year: year,
      },
    });

    const monthlyMap = new Map(monthlyStats.map(m => [m.employee_id, m]));

    // Look up previous cycle to automatically carry forward leaves (Req 4.2)
    let prevMonthIndex = monthIndex - 1;
    let prevYear = year;
    if (prevMonthIndex < 0) {
      prevMonthIndex = 11;
      prevYear = year - 1;
    }
    const prevCycle = await PayrollCycle.findOne({
      where: { month_index: prevMonthIndex, year: prevYear },
      include: [{ model: PayrollEntry, as: 'entries' }]
    });
    const prevCarryMap = new Map();
    if (prevCycle && prevCycle.entries) {
      for (const pEntry of prevCycle.entries) {
        const carry = Number(pEntry.leave_carry_forward_days) || 0;
        if (carry > 0) {
          prevCarryMap.set(pEntry.employee_id, carry);
        }
      }
    }

    // Also include any LeaveRequests designated with 'carry_forward_next' treatment (Req 10)
    const { LeaveRequest: LRModel } = require('../models');
    const carriedLeaves = await LRModel.findAll({
      where: {
        status: 'approved',
        payroll_treatment: 'carry_forward_next',
      }
    });
    for (const l of carriedLeaves) {
      const cur = prevCarryMap.get(l.employee_id) || 0;
      prevCarryMap.set(l.employee_id, cur + (Number(l.duration) || 1));
    }

    const entries = employees.map(emp => {
      const monthly = monthlyMap.get(emp.id);
      const absentDays = monthly ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5) : 0;
      const carriedDays = prevCarryMap.get(emp.id) || 0;
      return {
        cycle_id: cycle.id,
        employee_id: emp.id,
        absent_days: absentDays,
        leave_adjustment_days: carriedDays,
        admin_notes: carriedDays > 0 ? `Auto-carried ${carriedDays} leave days from ${prevCycle?.month || 'previous cycle'}` : null,
        status: 'Draft',
      };
    });

    if (entries.length > 0) {
      await PayrollEntry.bulkCreate(entries);
      logger.info(`Auto-created ${entries.length} entries for cycle ${cycle.month}`);
    }

    return cycle;
  }
}

module.exports = new PayrollLedgerService();