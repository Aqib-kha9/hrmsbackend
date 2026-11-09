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

    // If Admin explicitly set manual_payable_days, respect it directly; else compute from effective absent days + weekly off compensation (Req 2.5 D)
    const weeklyOffComp = Number(row.weekly_off_worked_days || 0);
    const payableDays = (row.manual_payable_days !== null && row.manual_payable_days !== undefined && !isNaN(Number(row.manual_payable_days)))
      ? Math.max(0, Math.min(D + weeklyOffComp, Number(row.manual_payable_days)))
      : Math.max(0, elapsedDays - effectiveAbsentDays + weeklyOffComp);

    const fixedGross = Number(row.fixed_gross) || 0;

    // 50% Basic Salary formula & component breakup (Req 2.4)
    const fixedBasic = Math.round(fixedGross * 0.50);
    const hraApplicable = row.hra_applicable !== false;
    const fixedHra = hraApplicable ? Math.round(fixedBasic * 0.40) : 0;
    const fixedConv = Number(row.conveyance) || 0;
    const fixedMed = Number(row.medical_allowance) || 0;
    const fixedSpec = Number(row.special_allowance) || 0;
    const fixedPerf = Number(row.performance_allowance) || 0;
    const fixedOther = Math.max(0, fixedGross - (fixedBasic + fixedHra + fixedConv + fixedMed + fixedSpec + fixedPerf));

    const basic = Math.round((fixedBasic / D) * payableDays);
    const hra = Math.round((fixedHra / D) * payableDays);
    const conveyance = Math.round((fixedConv / D) * payableDays);
    const medicalAllowance = Math.round((fixedMed / D) * payableDays);
    const specialAllowance = Math.round((fixedSpec / D) * payableDays);
    const performanceAllowance = Math.round((fixedPerf / D) * payableDays);
    const other = Math.round((fixedOther / D) * payableDays);
    const proratedGross = basic + hra + conveyance + medicalAllowance + specialAllowance + performanceAllowance + other;

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
    const annualCTC = totalMonthlyCTC * 12;

    return {
      fixedGross, fixedBasic, fixedHra, fixedConv, fixedMed, fixedSpec, fixedPerf, fixedOther,
      basic, hra, conveyance, medicalAllowance, specialAllowance, performanceAllowance, other,
      proratedGross, totalEarnings,
      payableDays,
      effectiveAbsentDays,
      leaveAdjustmentDays: leaveAdjust,
      leaveCarryForwardDays: carryForward,
      manualPayableDays: (row.manual_payable_days !== null && row.manual_payable_days !== undefined && !isNaN(Number(row.manual_payable_days))) ? Number(row.manual_payable_days) : null,
      lop: fixedGross - proratedGross,
      pf, esi, pt, grossDeductions, net,
      pfEmployer, esiEmployer, totalMonthlyCTC, annualCTC,
    };
  }

  // ── API: GET /payroll/ledger — current-cycle ledger rows ──

  async getCurrentLedger({ company_id, company } = {}) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // ── Dynamic working days for the current month ──
    const { workingDays: dynamicDays, weekendDays, holidays } =
      await this._getDynamicDaysInMonth(currentMonth + 1, currentYear);
    const elapsedWorkingDays = countElapsedWorkingDays(currentYear, currentMonth + 1, now, null, weekendDays, holidays);

    const ptSlabs = await getPTSlabs();

    // Fetch active companies for filter metadata
    const allCompanies = await Company.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'code'],
      order: [['name', 'ASC']],
    });

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
        return { cycle: null, rows: [], companies: allCompanies, companyBreakdown: [] };
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
        fixed_gross: activeStructure?.fixed_gross || emp.fixed_gross,
        pf_applicable: activeStructure ? activeStructure.pf_applicable : emp.pf_applicable,
        pf_ceiling: activeStructure ? activeStructure.pf_ceiling : emp.pf_ceiling,
        esic_applicable: activeStructure ? activeStructure.esic_applicable : emp.esic_applicable,
        pt_applicable: ptApplicable,
        hra_applicable: activeStructure ? activeStructure.hra_applicable : (emp.hra_applicable !== false),
        conveyance: activeStructure?.conveyance || 0,
        medical_allowance: activeStructure?.medical_allowance || 0,
        special_allowance: activeStructure?.special_allowance || 0,
        performance_allowance: activeStructure?.performance_allowance || emp.performance_allowance || 0,
        absent_days: absentDays,
        weekly_off_worked_days: monthly ? Number(monthly.weekly_off_worked_days || 0) : 0,
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

      const compId = emp.company_id || emp.company?.id || null;
      const compName = emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
      const compCode = emp.company?.code || (emp.emp_code ? String(emp.emp_code).replace(/[0-9]/g, '') : 'APA');

      return {
        id: entry.id,
        employeeId: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        location: emp.location || emp.office?.name || 'Unknown',
        companyId: compId,
        companyCode: compCode,
        company: compName,
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

    // Company breakdown across all entries
    const companyMap = new Map();
    rows.forEach(r => {
      const cKey = r.companyId ? String(r.companyId) : r.company;
      if (!companyMap.has(cKey)) {
        companyMap.set(cKey, {
          id: r.companyId,
          name: r.company,
          code: r.companyCode,
          staffCount: 0,
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          totalCTC: 0,
        });
      }
      const b = companyMap.get(cKey);
      b.staffCount += 1;
      b.totalGross += (r.totalEarnings || 0);
      b.totalDeductions += (r.grossDeductions || 0);
      b.totalNet += (r.net || 0);
      b.totalCTC += (r.totalMonthlyCTC || 0);
    });

    const companyBreakdown = Array.from(companyMap.values()).map(c => ({
      ...c,
      totalGross: Math.round(c.totalGross),
      totalDeductions: Math.round(c.totalDeductions),
      totalNet: Math.round(c.totalNet),
      totalCTC: Math.round(c.totalCTC),
    }));

    // Filter rows if company filter applied
    let filteredRows = rows;
    if (company_id && company_id !== 'all' && company_id !== 'ALL') {
      const cidNum = Number(company_id);
      filteredRows = rows.filter(r => (cidNum && r.companyId === cidNum) || String(r.companyId) === String(company_id) || r.company === String(company_id));
    } else if (company && company !== 'All' && company !== 'ALL') {
      const compLower = String(company).toLowerCase();
      filteredRows = rows.filter(r =>
        (r.company && r.company.toLowerCase() === compLower) ||
        (r.companyCode && r.companyCode.toLowerCase() === compLower)
      );
    }

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
      rows: filteredRows,
      allRowsCount: rows.length,
      companies: allCompanies,
      companyBreakdown,
    };
  }

  // ── API: GET /payroll/ledger/:cycleId — specific cycle rows ──

  async getLedgerByCycleId(cycleId, { company_id, company } = {}) {
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

    // Fetch active companies for filter dropdown
    const allCompanies = await Company.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'code'],
      order: [['name', 'ASC']],
    });

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

      const compId = emp.company_id || emp.company?.id || null;
      const compName = emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
      const compCode = emp.company?.code || (emp.emp_code ? String(emp.emp_code).replace(/[0-9]/g, '') : 'APA');

      return {
        id: entry.id,
        employeeId: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        location: emp.location || emp.office?.name || 'Unknown',
        companyId: compId,
        companyCode: compCode,
        company: compName,
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

    // Company breakdown
    const companyMap = new Map();
    rows.forEach(r => {
      const cKey = r.companyId ? String(r.companyId) : r.company;
      if (!companyMap.has(cKey)) {
        companyMap.set(cKey, {
          id: r.companyId,
          name: r.company,
          code: r.companyCode,
          staffCount: 0,
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          totalCTC: 0,
        });
      }
      const b = companyMap.get(cKey);
      b.staffCount += 1;
      b.totalGross += (r.totalEarnings || 0);
      b.totalDeductions += (r.grossDeductions || 0);
      b.totalNet += (r.net || 0);
      b.totalCTC += (r.totalMonthlyCTC || 0);
    });

    const companyBreakdown = Array.from(companyMap.values()).map(c => ({
      ...c,
      totalGross: Math.round(c.totalGross),
      totalDeductions: Math.round(c.totalDeductions),
      totalNet: Math.round(c.totalNet),
      totalCTC: Math.round(c.totalCTC),
    }));

    // Filter rows if company specified
    let filteredRows = rows;
    if (company_id && company_id !== 'all' && company_id !== 'ALL') {
      const cidNum = Number(company_id);
      filteredRows = rows.filter(r => (cidNum && r.companyId === cidNum) || String(r.companyId) === String(company_id) || r.company === String(company_id));
    } else if (company && company !== 'All' && company !== 'ALL') {
      const compLower = String(company).toLowerCase();
      filteredRows = rows.filter(r =>
        (r.company && r.company.toLowerCase() === compLower) ||
        (r.companyCode && r.companyCode.toLowerCase() === compLower)
      );
    }

    return { cycle, rows: filteredRows, allRowsCount: rows.length, companies: allCompanies, companyBreakdown };
  }

  // ── API: GET /payroll/history — past cycles summary ──

  async getCycleHistory({ page = 1, limit = PAGINATION.DEFAULT_LIMIT, year, company_id, company } = {}) {
    const where = {};
    if (year) where.year = year;

    const { rows, count } = await PayrollCycle.findAndCountAll({
      where,
      include: [{
        model: PayrollEntry,
        as: 'entries',
        include: [{
          model: Employee,
          as: 'employee',
          include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }]
        }],
      }],
      order: [['year', 'DESC'], ['month_index', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const history = await Promise.all(rows.map(async (cycle) => {
      let entries = cycle.entries || [];
      let totalPayout = 0;
      let totalGross = 0;
      let totalDeductions = 0;
      const branchMap = new Map();
      const companyMap = new Map();

      // Dynamic working days for this cycle's month (past cycle = full month)
      const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(cycle.month_index + 1, cycle.year);

      for (const entry of entries) {
        const emp = entry.employee;
        if (!emp) continue;

        const compId = emp.company_id || emp.company?.id || null;
        const compName = emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
        const compCode = emp.company?.code || (emp.emp_code ? String(emp.emp_code).replace(/[0-9]/g, '') : 'APA');

        const calc = this._calculateRow({
          ...emp.toJSON(),
          ...entry.toJSON(),
          fixed_gross: emp.fixed_gross,
          pf_applicable: emp.pf_applicable,
          pf_ceiling: emp.pf_ceiling,
          esic_applicable: emp.esic_applicable,
        }, dynamicDays);

        // Accumulate company breakdown across all entries in the cycle
        const compKey = compId ? String(compId) : compName;
        if (!companyMap.has(compKey)) {
          companyMap.set(compKey, { id: compId, name: compName, code: compCode, payout: 0, gross: 0, deductions: 0, staff: 0 });
        }
        const c = companyMap.get(compKey);
        c.payout += calc.net;
        c.gross += calc.totalEarnings;
        c.deductions += calc.grossDeductions;
        c.staff += 1;

        // If company filter is applied, only sum matching employees for the cycle total
        let matchesCompanyFilter = true;
        if (company_id && company_id !== 'all' && company_id !== 'ALL') {
          const cidNum = Number(company_id);
          matchesCompanyFilter = (cidNum && compId === cidNum) || String(compId) === String(company_id) || compName === String(company_id);
        } else if (company && company !== 'All' && company !== 'ALL') {
          const compLower = String(company).toLowerCase();
          matchesCompanyFilter = compName.toLowerCase() === compLower || compCode.toLowerCase() === compLower;
        }

        if (!matchesCompanyFilter) continue;

        totalPayout += calc.net;
        totalGross += calc.totalEarnings;
        totalDeductions += calc.grossDeductions;

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

      const companyBreakdown = Array.from(companyMap.values()).map(c => ({
        ...c,
        payout: Math.round(c.payout),
        gross: Math.round(c.gross),
        deductions: Math.round(c.deductions),
      }));

      const filteredStaffCount = entries.filter(e => {
        if (!e.employee) return false;
        if (company_id && company_id !== 'all' && company_id !== 'ALL') {
          const cidNum = Number(company_id);
          const compId = e.employee.company_id || e.employee.company?.id;
          const compName = e.employee.company?.name || e.employee.company_name;
          return (cidNum && compId === cidNum) || String(compId) === String(company_id) || compName === String(company_id);
        } else if (company && company !== 'All' && company !== 'ALL') {
          const compLower = String(company).toLowerCase();
          const compName = e.employee.company?.name || e.employee.company_name || '';
          const compCode = e.employee.company?.code || '';
          return compName.toLowerCase() === compLower || compCode.toLowerCase() === compLower;
        }
        return true;
      }).length;

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
        totalGross: Math.round(totalGross),
        totalDeductions: Math.round(totalDeductions),
        totalStaff: filteredStaffCount,
        allStaffCount: entries.length,
        branches: branchBreakdown,
        companies: companyBreakdown,
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
      hra_applicable: structure ? structure.hra_applicable : (emp.hra_applicable !== false),
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
      special_allowance: structure?.special_allowance || 0,
      performance_allowance: structure?.performance_allowance || emp.performance_allowance || 0,
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
      // Standard / Fixed Structure (Req 3.3 & Req 2.4)
      fixed_gross: calc.fixedGross,
      fixed_basic: calc.fixedBasic,
      fixed_hra: calc.fixedHra,
      fixed_other: calc.fixedOther,
      fixed_conveyance: calc.fixedConv,
      fixed_medical: calc.fixedMed,
      fixed_special: calc.fixedSpec,
      fixed_performance: calc.fixedPerf,
      // Earnings & Deductions (Req 3.3 & Req 2.4)
      basic_salary: calc.basic,
      hra: calc.hra,
      other_allowance: calc.other,
      special_allowance: calc.specialAllowance || structure?.special_allowance || 0,
      conveyance: calc.conveyance || structure?.conveyance || 0,
      medical_allowance: calc.medicalAllowance || structure?.medical_allowance || 0,
      performance_allowance: calc.performanceAllowance || structure?.performance_allowance || 0,
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
      annual_ctc: calc.annualCTC || (calc.totalMonthlyCTC * 12),
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

  // ── API: GET /payroll/financial-summary (Section 2.9) ──
  async getFinancialSummary({ periodType = 'monthly', year, month, company_id, company } = {}) {
    const now = new Date();
    const targetYear = year ? parseInt(year, 10) : now.getFullYear();
    const targetMonth = month ? parseInt(month, 10) : (now.getMonth() + 1); // 1-indexed (1-12)

    const allCompanies = await Company.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'code'],
      order: [['name', 'ASC']],
    });

    const matchesCompany = (emp) => {
      if (!emp) return false;
      const compId = emp.company_id || emp.company?.id;
      const compName = emp.company?.name || emp.company_name;
      const compCode = emp.company?.code;
      if (company_id && company_id !== 'all' && company_id !== 'ALL') {
        const cidNum = Number(company_id);
        return (cidNum && compId === cidNum) || String(compId) === String(company_id) || compName === String(company_id);
      }
      if (company && company !== 'All' && company !== 'ALL') {
        const compLower = String(company).toLowerCase();
        return (compName && compName.toLowerCase() === compLower) || (compCode && compCode.toLowerCase() === compLower);
      }
      return true;
    };

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    if (periodType === 'yearly') {
      // ── YEARLY FINANCIAL SUMMARY ──
      const cycles = await PayrollCycle.findAll({
        where: { year: targetYear },
        include: [{
          model: PayrollEntry,
          as: 'entries',
          include: [{
            model: Employee,
            as: 'employee',
            include: [
              { model: Office, as: 'office' },
              { model: Company, as: 'company' },
              { model: SalaryStructure, as: 'salaryStructures' }
            ]
          }]
        }],
        order: [['month_index', 'ASC']],
      });

      let totalAnnualCost = 0;
      let totalAnnualGross = 0;
      let totalAnnualDeductions = 0;
      let totalAnnualNetPayout = 0;
      let peakStaffCount = 0;
      let totalDaysInYearWorking = 0;

      const monthlySummaries = await Promise.all(cycles.map(async (cycle) => {
        const mIndex = cycle.month_index;
        const { workingDays: dynamicDays } = await this._getDynamicDaysInMonth(mIndex + 1, targetYear);
        totalDaysInYearWorking += dynamicDays;

        let mGross = 0;
        let mNet = 0;
        let mDeductions = 0;
        let mCompanyCost = 0;
        let mStaff = 0;

        for (const entry of (cycle.entries || [])) {
          const emp = entry.employee;
          if (!emp || !matchesCompany(emp)) continue;

          const activeStructure = emp.salaryStructures?.find(s => s.status === 'active');
          const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : true;
          const calc = this._calculateRow({
            ...emp.toJSON(),
            ...entry.toJSON(),
            fixed_gross: activeStructure?.fixed_gross || emp.fixed_gross,
            pf_applicable: activeStructure ? activeStructure.pf_applicable : emp.pf_applicable,
            pf_ceiling: activeStructure ? activeStructure.pf_ceiling : emp.pf_ceiling,
            esic_applicable: activeStructure ? activeStructure.esic_applicable : emp.esic_applicable,
            pt_applicable: ptApplicable,
            hra_applicable: activeStructure ? activeStructure.hra_applicable : (emp.hra_applicable !== false),
          }, dynamicDays);

          mGross += calc.proratedGross;
          mNet += calc.net;
          mDeductions += calc.grossDeductions;
          mCompanyCost += calc.totalMonthlyCTC;
          mStaff += 1;
        }

        totalAnnualGross += mGross;
        totalAnnualNetPayout += mNet;
        totalAnnualDeductions += mDeductions;
        totalAnnualCost += mCompanyCost;
        if (mStaff > peakStaffCount) peakStaffCount = mStaff;

        return {
          monthIndex: mIndex,
          monthName: monthNames[mIndex],
          label: `${monthNames[mIndex]} ${targetYear}`,
          staffCount: mStaff,
          grossSalary: Math.round(mGross),
          deductions: Math.round(mDeductions),
          netPayout: Math.round(mNet),
          companyCost: Math.round(mCompanyCost),
          costPerDay: dynamicDays > 0 ? Math.round(mCompanyCost / dynamicDays) : 0,
          status: cycle.status,
        };
      }));

      const activeEmployees = await Employee.findAll({
        where: { status: 'active', role: { [Op.ne]: 'admin' } },
        include: [{ model: Office, as: 'office' }, { model: Company, as: 'company' }, { model: SalaryStructure, as: 'salaryStructures' }]
      });
      const filteredActive = activeEmployees.filter(matchesCompany);

      let currentMonthlyCTC = 0;
      filteredActive.forEach(emp => {
        const str = emp.salaryStructures?.find(s => s.status === 'active');
        const gross = Number(str?.fixed_gross || emp.fixed_gross || 0);
        currentMonthlyCTC += (gross * 1.15);
      });
      const currentDailyCost = Math.round(currentMonthlyCTC / 26);

      const monthsCount = Math.max(1, cycles.length);
      const avgMonthlyBurn = Math.round(totalAnnualCost / monthsCount);
      const avgCostPerDay = totalDaysInYearWorking > 0 ? Math.round(totalAnnualCost / totalDaysInYearWorking) : currentDailyCost;

      return {
        periodType: 'yearly',
        year: targetYear,
        metrics: {
          companyCostPerDay: avgCostPerDay || currentDailyCost,
          generatedPayout: Math.round(totalAnnualNetPayout),
          projectedPayout: Math.round(totalAnnualNetPayout + (avgMonthlyBurn * Math.max(0, 12 - cycles.length))),
          totalActiveStaff: filteredActive.length,
          totalAnnualCost: Math.round(totalAnnualCost),
          totalAnnualGross: Math.round(totalAnnualGross),
          totalAnnualDeductions: Math.round(totalAnnualDeductions),
          totalAnnualNetPayout: Math.round(totalAnnualNetPayout),
          averageMonthlyBurn: avgMonthlyBurn,
          peakStaffCount: Math.max(peakStaffCount, filteredActive.length),
        },
        monthlyBreakdown: monthlySummaries,
        companies: allCompanies,
      };
    } else {
      // ── MONTHLY FINANCIAL SUMMARY ──
      const monthIndex = targetMonth - 1;
      const isCurrentMonth = (now.getFullYear() === targetYear && now.getMonth() === monthIndex);

      const { workingDays: dynamicDays, weekendDays, holidays } = await this._getDynamicDaysInMonth(targetMonth, targetYear);
      const elapsedWorkingDays = isCurrentMonth
        ? countElapsedWorkingDays(targetYear, targetMonth, now, null, weekendDays, holidays)
        : dynamicDays;

      const ptSlabs = await getPTSlabs();

      let cycle = await PayrollCycle.findOne({
        where: { month_index: monthIndex, year: targetYear },
        include: [{
          model: PayrollEntry,
          as: 'entries',
          include: [{
            model: Employee,
            as: 'employee',
            include: [
              { model: Office, as: 'office' },
              { model: Company, as: 'company' },
              { model: SalaryStructure, as: 'salaryStructures' }
            ]
          }]
        }]
      });

      if (!cycle && isCurrentMonth) {
        cycle = await this._createCycleForMonth(monthIndex, targetYear);
        if (cycle) {
          cycle = await PayrollCycle.findOne({
            where: { month_index: monthIndex, year: targetYear },
            include: [{
              model: PayrollEntry,
              as: 'entries',
              include: [{
                model: Employee,
                as: 'employee',
                include: [
                  { model: Office, as: 'office' },
                  { model: Company, as: 'company' },
                  { model: SalaryStructure, as: 'salaryStructures' }
                ]
              }]
            }]
          });
        }
      }

      const { MonthlyAttendance, Loan } = require('../models');
      const monthlyStats = await MonthlyAttendance.findAll({
        where: { month: targetMonth, year: targetYear },
      });
      const monthlyMap = new Map(monthlyStats.map(m => [m.employee_id, m]));

      const activeLoans = await Loan.findAll({ where: { status: 'active' } });
      const loanMap = new Map();
      activeLoans.forEach(loan => {
        const cur = loanMap.get(loan.employee_id) || 0;
        loanMap.set(loan.employee_id, cur + Number(loan.emi_amount));
      });

      const entries = cycle ? (cycle.entries || []) : [];
      let totalDailyCost = 0;
      let totalGeneratedPayout = 0;
      let totalProjectedPayout = 0;
      let totalGrossSalary = 0;
      let totalDeductions = 0;
      let totalMonthlyCost = 0;
      const employeeBreakdown = [];

      for (const entry of entries) {
        const emp = entry.employee;
        if (!emp || !matchesCompany(emp)) continue;

        const monthly = monthlyMap.get(emp.id);
        const absentDays = monthly
          ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
          : (entry.absent_days || 0);

        const syncedLoan = loanMap.get(emp.id);
        const loanDeduction = syncedLoan !== undefined ? syncedLoan : (Number(entry.loan_deduction) || 0);

        const activeStructure = emp.salaryStructures?.find(s => s.status === 'active');
        const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : true;

        const baseData = {
          ...emp.toJSON(),
          ...entry.toJSON(),
          loan_deduction: loanDeduction,
          fixed_gross: activeStructure?.fixed_gross || emp.fixed_gross,
          pf_applicable: activeStructure ? activeStructure.pf_applicable : emp.pf_applicable,
          pf_ceiling: activeStructure ? activeStructure.pf_ceiling : emp.pf_ceiling,
          esic_applicable: activeStructure ? activeStructure.esic_applicable : emp.esic_applicable,
          pt_applicable: ptApplicable,
          hra_applicable: activeStructure ? activeStructure.hra_applicable : (emp.hra_applicable !== false),
          conveyance: activeStructure?.conveyance || 0,
          medical_allowance: activeStructure?.medical_allowance || 0,
          special_allowance: activeStructure?.special_allowance || 0,
          performance_allowance: activeStructure?.performance_allowance || emp.performance_allowance || 0,
          absent_days: absentDays,
          weekly_off_worked_days: monthly ? Number(monthly.weekly_off_worked_days || 0) : 0,
        };

        const calcTillToday = this._calculateRow({
          ...baseData,
          _elapsedDays: elapsedWorkingDays,
        }, dynamicDays, ptSlabs);

        const calcProjected = this._calculateRow({
          ...baseData,
          _elapsedDays: dynamicDays,
        }, dynamicDays, ptSlabs);

        const projectedMonthlyCTC = calcProjected.totalMonthlyCTC;
        const dailyCost = Math.round(projectedMonthlyCTC / dynamicDays);
        const payableDays = Math.max(0, elapsedWorkingDays - absentDays);

        totalDailyCost += dailyCost;
        totalGeneratedPayout += calcTillToday.net;
        totalProjectedPayout += calcProjected.net;
        totalGrossSalary += calcTillToday.proratedGross;
        totalDeductions += calcTillToday.grossDeductions;
        totalMonthlyCost += calcTillToday.totalMonthlyCTC;

        const compId = emp.company_id || emp.company?.id || null;
        const compName = emp.company?.name || emp.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
        const compCode = emp.company?.code || (emp.emp_code ? String(emp.emp_code).replace(/[0-9]/g, '') : 'APA');

        employeeBreakdown.push({
          id: entry.id,
          employeeId: emp.id,
          employeeCode: emp.emp_code,
          name: emp.name,
          designation: emp.designation || 'Staff',
          location: emp.location || emp.office?.name || 'Unknown',
          company: compName,
          companyCode: compCode,
          fixedGross: Number(emp.fixed_gross) || 0,
          dailyCost,
          payableDays,
          dynamicDays,
          elapsedDays: elapsedWorkingDays,
          generatedPayout: calcTillToday.net,
          projectedMonthly: calcProjected.net,
          monthlyCTC: calcTillToday.totalMonthlyCTC,
          status: entry.status || cycle?.status || 'Draft',
        });
      }

      const recentCycles = await PayrollCycle.findAll({
        where: { year: targetYear },
        order: [['month_index', 'ASC']],
      });

      const trend = recentCycles.map(c => ({
        monthIndex: c.month_index,
        monthName: monthNames[c.month_index],
        status: c.status,
      }));

      return {
        periodType: 'monthly',
        year: targetYear,
        month: targetMonth,
        monthName: `${monthNames[monthIndex]} ${targetYear}`,
        isCurrentMonth,
        elapsedWorkingDays,
        dynamicDays,
        metrics: {
          companyCostPerDay: Math.round(totalDailyCost),
          generatedPayout: Math.round(totalGeneratedPayout),
          projectedPayout: Math.round(totalProjectedPayout),
          totalActiveStaff: employeeBreakdown.length,
          totalGrossSalary: Math.round(totalGrossSalary),
          totalDeductions: Math.round(totalDeductions),
          totalNetPayable: Math.round(totalGeneratedPayout),
          totalMonthlyCost: Math.round(totalMonthlyCost),
        },
        employees: employeeBreakdown,
        companies: allCompanies,
        trend,
      };
    }
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