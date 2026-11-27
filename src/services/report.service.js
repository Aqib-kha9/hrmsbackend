const { Employee, MonthlyAttendance, PayrollEntry, PayrollCycle, Office, Company, TourExpense, SalaryStructure, sequelize } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PT_SLABS } = require('../utils/constants');
const { getWeekendDays, getHolidaysInMonth, countWorkingDaysInMonth, countElapsedWorkingDays, getPTSlabs } = require('../utils/payrollHelper');

/**
 * Report service — production-grade report data aggregator.
 *
 * Mirrors the payroll ledger's _calculateRow logic to ensure consistency
 * across all report views (payroll, attendance, statutory, branch).
 *
 * Calculation breakdown (40% rule):
 *   fixedBasic = round(fixedGross * 0.40)
 *   fixedHra   = round(fixedBasic * 0.40)
 *   fixedOther = fixedGross - fixedBasic - fixedHra
 *   basic  = round((fixedBasic  / workingDays) * payableDays)
 *   hra    = round((fixedHra    / workingDays) * payableDays)
 *   other  = round((fixedOther  / workingDays) * payableDays)
 *   proratedGross = basic + hra + other
 *   totalEarnings = proratedGross + arrears + bonus + incentive
 *   PF = pfApplicable ? (pfCeiling ? min(basic, 15000) : basic) * 0.12 : 0
 *   ESI = esicApplicable ? ceil(totalEarnings * 0.0075) : 0
 *   PT = slab-based
 */
class ReportService {

  // ─────────────────────────────────────────────────────────────────
  // Core calculation (mirrors PayrollLedgerService._calculateRow)
  // ─────────────────────────────────────────────────────────────────
  _calculateRow(row, workingDays, elapsedWorkingDays, slabs) {
    const D = workingDays;
    const elapsed = elapsedWorkingDays != null ? Math.min(elapsedWorkingDays, D) : D;
    const payableDays = Math.max(0, elapsed - (row.absent_days || 0));
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

    // PF
    let pf = 0;
    let pfEmployer = 0;
    if (row.pf_applicable) {
      const pfBase = row.pf_ceiling ? Math.min(basic, 15000) : basic;
      pf = Math.round(pfBase * 0.12);
      pfEmployer = Math.round(pfBase * 0.12);
    }

    // ESI
    let esi = 0;
    let esiEmployer = 0;
    if (row.esic_applicable) {
      esi = Math.ceil(totalEarnings * 0.0075);
      esiEmployer = Math.ceil(totalEarnings * 0.0325);
    }

    // PT
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
      basic, hra, other, proratedGross, totalEarnings,
      pf, esi, pt, grossDeductions, net,
      pfEmployer, esiEmployer, totalMonthlyCTC,
      payableDays, workingDays: D,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Dynamic working days helper
  // ─────────────────────────────────────────────────────────────────
  async _getDynamicDays(month, year) {
    const weekendDays = await getWeekendDays();
    const holidays = await getHolidaysInMonth(year, month);
    const workingDays = countWorkingDaysInMonth(year, month, weekendDays, holidays);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let elapsedWorkingDays = workingDays;
    if (month === currentMonth && year === currentYear) {
      elapsedWorkingDays = countElapsedWorkingDays(year, month, now, null, weekendDays, holidays);
    }
    return { workingDays, weekendDays, holidays, elapsedWorkingDays };
  }

  // ─────────────────────────────────────────────────────────────────
  // Fetch employee + payroll entry data for a given cycle
  // ─────────────────────────────────────────────────────────────────
  async _getLedgerData(month, year, officeId, search) {
    // month is 1-indexed, year is full year
    const monthIndex = month - 1; // 0-indexed for PayrollCycle

    // Build employee where clause
    const empWhere = { status: 'active' };
    if (officeId) empWhere.office_id = officeId;
    if (search) {
      empWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const employees = await Employee.findAll({
      where: empWhere,
      include: [
        { model: Office, as: 'office', attributes: ['id', 'name', 'city'] },
        { model: Company, as: 'company', attributes: ['id', 'name'] },
        { model: SalaryStructure, as: 'salaryStructures' },
      ],
      order: [['name', 'ASC']],
    });

    // Fetch monthly attendance for the given month
    const monthlyStats = await MonthlyAttendance.findAll({
      where: { month, year },
    });
    const monthlyMap = new Map(monthlyStats.map(m => [m.employee_id, m]));

    // Fetch payroll entries for the cycle (if exists)
    const cycle = await PayrollCycle.findOne({
      where: { month_index: monthIndex, year },
      include: [{ model: PayrollEntry, as: 'entries' }],
    });
    const entryMap = new Map();
    if (cycle && cycle.entries) {
      for (const entry of cycle.entries) {
        entryMap.set(entry.employee_id, entry);
      }
    }

    return { employees, monthlyMap, entryMap, cycle };
  }

  // ─────────────────────────────────────────────────────────────────
  // PAYROLL REPORT — full CTC breakdown
  // ─────────────────────────────────────────────────────────────────
  async getPayrollReport({ month, year, office_id, search } = {}) {
    const { employees, monthlyMap, entryMap, cycle } = await this._getLedgerData(month, year, office_id, search);
    const { workingDays, elapsedWorkingDays } = await this._getDynamicDays(month, year);
    const ptSlabs = await getPTSlabs();

    const rows = employees.map(emp => {
      const monthly = monthlyMap.get(emp.id);
      const entry = entryMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : (entry ? entry.absent_days : 0);

      const activeStructure = emp.salaryStructures?.find(s => s.status === 'active') || (emp.salaryStructures && emp.salaryStructures[0]) || null;
      const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : (emp.pt_applicable !== false);
      const fixedGross = Number(activeStructure?.fixed_gross) || Number(emp.fixed_gross) || 0;
      const pfApplicable = activeStructure ? (activeStructure.pf_applicable !== false) : (emp.pf_applicable !== false);
      const pfCeiling = activeStructure ? (activeStructure.pf_ceiling || false) : (emp.pf_ceiling || false);
      const esicApplicable = activeStructure ? (activeStructure.esic_applicable || false) : (emp.esic_applicable || false);

      const calc = this._calculateRow({
        fixed_gross: fixedGross,
        pf_applicable: pfApplicable,
        pf_ceiling: pfCeiling,
        esic_applicable: esicApplicable,
        pt_applicable: ptApplicable,
        absent_days: absentDays,
        previous_arrears: entry ? entry.previous_arrears : 0,
        bonus: entry ? entry.bonus : 0,
        incentive: entry ? entry.incentive : 0,
        loan_deduction: entry ? entry.loan_deduction : 0,
        other_deduction: entry ? entry.other_deduction : 0,
      }, workingDays, elapsedWorkingDays, ptSlabs);

      return {
        id: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        location: emp.location || emp.office?.city || 'Unknown',
        company: emp.company_name || emp.company?.name || 'Apaar Logistics',
        designation: emp.designation || '',
        fixedGross: fixedGross,
        pfApplicable: pfApplicable,
        pfCeiling: pfCeiling,
        esicApplicable: esicApplicable,
        absentDays: Math.round(absentDays * 10) / 10,
        bonus: Number(entry?.bonus) || 0,
        previousArrears: Number(entry?.previous_arrears) || 0,
        incentive: Number(entry?.incentive) || 0,
        loanDeduction: Number(entry?.loan_deduction) || 0,
        otherDeduction: Number(entry?.other_deduction) || 0,
        status: entry?.status || cycle?.status || 'Draft',
        ...calc,
      };
    });

    // Summary aggregates
    const totalStaff = rows.length;
    const totalGrossPayout = rows.reduce((acc, r) => acc + r.proratedGross, 0);
    const totalNetPayout = rows.reduce((acc, r) => acc + r.net, 0);
    const totalDeductions = rows.reduce((acc, r) => acc + r.grossDeductions, 0);
    const totalEmployerLiability = rows.reduce((acc, r) => acc + r.pfEmployer + r.esiEmployer, 0);
    const averageAttendance = workingDays > 0
      ? Math.round(rows.reduce((acc, r) => acc + r.payableDays, 0) / (totalStaff * workingDays) * 100)
      : 0;

    return {
      cycle: cycle ? {
        id: cycle.id,
        month: cycle.month,
        month_index: cycle.month_index,
        year: cycle.year,
        status: cycle.status,
        paid_on: cycle.paid_on,
        disbursement_mode: cycle.disbursement_mode,
      } : null,
      workingDays,
      elapsedWorkingDays,
      summary: {
        totalStaff,
        totalGrossPayout,
        totalNetPayout,
        totalDeductions,
        totalEmployerLiability,
        averageAttendance,
      },
      rows,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // ATTENDANCE REPORT — LWP, payable days, attendance rate
  // ─────────────────────────────────────────────────────────────────
  async getAttendanceReport({ month, year, office_id, search } = {}) {
    const { employees, monthlyMap, entryMap } = await this._getLedgerData(month, year, office_id, search);
    const { workingDays, elapsedWorkingDays } = await this._getDynamicDays(month, year);

    const rows = employees.map(emp => {
      const monthly = monthlyMap.get(emp.id);
      const entry = entryMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : (entry ? entry.absent_days : 0);

      const elapsed = elapsedWorkingDays != null ? Math.min(elapsedWorkingDays, workingDays) : workingDays;
      const payableDays = Math.max(0, elapsed - absentDays);
      const attendanceRate = workingDays > 0 ? Math.round((payableDays / workingDays) * 100) : 0;

      return {
        id: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        designation: emp.designation || '',
        location: emp.location || emp.office?.city || 'Unknown',
        totalWorkingDays: workingDays,
        elapsedDays: elapsed,
        absentDays: Math.round(absentDays * 10) / 10,
        payableDays,
        attendanceRate,
        presentDays: monthly ? monthly.present_days : 0,
        lateDays: monthly ? monthly.late_days : 0,
        halfDays: monthly ? monthly.half_days : 0,
        holidayDays: monthly ? monthly.holiday_days : 0,
        weekendDays: monthly ? monthly.weekend_days : 0,
        tourDays: monthly ? monthly.tour_days : 0,
      };
    });

    const totalStaff = rows.length;
    const averageAttendance = totalStaff > 0
      ? Math.round(rows.reduce((acc, r) => acc + r.attendanceRate, 0) / totalStaff)
      : 0;

    return {
      workingDays,
      elapsedWorkingDays,
      summary: {
        totalStaff,
        averageAttendance,
        totalAbsentDays: rows.reduce((acc, r) => acc + r.absentDays, 0),
      },
      rows,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // STATUTORY REPORT — PF/ESI/PT liabilities breakdown
  // ─────────────────────────────────────────────────────────────────
  async getStatutoryReport({ month, year, office_id, search } = {}) {
    const { employees, monthlyMap, entryMap, cycle } = await this._getLedgerData(month, year, office_id, search);
    const { workingDays, elapsedWorkingDays } = await this._getDynamicDays(month, year);

    const rows = employees.map(emp => {
      const monthly = monthlyMap.get(emp.id);
      const entry = entryMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : (entry ? entry.absent_days : 0);

      const activeStructure = emp.salaryStructures?.find(s => s.status === 'active') || (emp.salaryStructures && emp.salaryStructures[0]) || null;
      const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : (emp.pt_applicable !== false);
      const fixedGross = Number(activeStructure?.fixed_gross) || Number(emp.fixed_gross) || 0;
      const pfApplicable = activeStructure ? (activeStructure.pf_applicable !== false) : (emp.pf_applicable !== false);
      const pfCeiling = activeStructure ? (activeStructure.pf_ceiling || false) : (emp.pf_ceiling || false);
      const esicApplicable = activeStructure ? (activeStructure.esic_applicable || false) : (emp.esic_applicable || false);

      const calc = this._calculateRow({
        fixed_gross: fixedGross,
        pf_applicable: pfApplicable,
        pf_ceiling: pfCeiling,
        esic_applicable: esicApplicable,
        pt_applicable: ptApplicable,
        absent_days: absentDays,
        previous_arrears: entry ? entry.previous_arrears : 0,
        bonus: entry ? entry.bonus : 0,
        incentive: entry ? entry.incentive : 0,
        loan_deduction: entry ? entry.loan_deduction : 0,
        other_deduction: entry ? entry.other_deduction : 0,
      }, workingDays, elapsedWorkingDays);

      return {
        id: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        designation: emp.designation || '',
        location: emp.location || emp.office?.city || 'Unknown',
        pfEmployee: calc.pf,
        pfEmployer: calc.pfEmployer,
        esiEmployee: calc.esi,
        esiEmployer: calc.esiEmployer,
        pt: calc.pt,
        loanDeduction: Number(entry?.loan_deduction) || 0,
        otherDeduction: Number(entry?.other_deduction) || 0,
        totalMonthlyCTC: calc.totalMonthlyCTC,
        grossDeductions: calc.grossDeductions,
        status: entry?.status || cycle?.status || 'Draft',
      };
    });

    const totalStaff = rows.length;
    const totalPfEmployee = rows.reduce((acc, r) => acc + r.pfEmployee, 0);
    const totalPfEmployer = rows.reduce((acc, r) => acc + r.pfEmployer, 0);
    const totalEsiEmployee = rows.reduce((acc, r) => acc + r.esiEmployee, 0);
    const totalEsiEmployer = rows.reduce((acc, r) => acc + r.esiEmployer, 0);
    const totalPt = rows.reduce((acc, r) => acc + r.pt, 0);
    const totalCTCLiability = rows.reduce((acc, r) => acc + r.totalMonthlyCTC, 0);

    return {
      workingDays,
      summary: {
        totalStaff,
        totalPfEmployee,
        totalPfEmployer,
        totalEsiEmployee,
        totalEsiEmployer,
        totalPt,
        totalCTCLiability,
        totalStatutoryDeductions: totalPfEmployee + totalEsiEmployee + totalPt,
      },
      rows,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // BRANCH REPORT — aggregated by office/location
  // ─────────────────────────────────────────────────────────────────
  async getBranchReport({ month, year } = {}) {
    const { employees, monthlyMap, entryMap } = await this._getLedgerData(month, year, null, null);
    const { workingDays, elapsedWorkingDays } = await this._getDynamicDays(month, year);

    // Group by location
    const branchMap = new Map();

    for (const emp of employees) {
      const location = emp.location || emp.office?.city || 'Unknown';
      if (!branchMap.has(location)) {
        branchMap.set(location, {
          location,
          officeName: emp.office?.name || location,
          headcount: 0,
          totalFixedGross: 0,
          totalNet: 0,
          totalPfEmployer: 0,
          totalEsiEmployer: 0,
          totalCTC: 0,
          employees: [],
        });
      }

      const branch = branchMap.get(location);
      const monthly = monthlyMap.get(emp.id);
      const entry = entryMap.get(emp.id);
      const absentDays = monthly
        ? (Number(monthly.absent_days) + Number(monthly.half_days) * 0.5)
        : (entry ? entry.absent_days : 0);

      const activeStructure = emp.salaryStructures?.find(s => s.status === 'active') || (emp.salaryStructures && emp.salaryStructures[0]) || null;
      const ptApplicable = activeStructure ? (activeStructure.pt_applicable !== false) : (emp.pt_applicable !== false);
      const fixedGross = Number(activeStructure?.fixed_gross) || Number(emp.fixed_gross) || 0;
      const pfApplicable = activeStructure ? (activeStructure.pf_applicable !== false) : (emp.pf_applicable !== false);
      const pfCeiling = activeStructure ? (activeStructure.pf_ceiling || false) : (emp.pf_ceiling || false);
      const esicApplicable = activeStructure ? (activeStructure.esic_applicable || false) : (emp.esic_applicable || false);

      const calc = this._calculateRow({
        fixed_gross: fixedGross,
        pf_applicable: pfApplicable,
        pf_ceiling: pfCeiling,
        esic_applicable: esicApplicable,
        pt_applicable: ptApplicable,
        absent_days: absentDays,
        previous_arrears: entry ? entry.previous_arrears : 0,
        bonus: entry ? entry.bonus : 0,
        incentive: entry ? entry.incentive : 0,
        loan_deduction: entry ? entry.loan_deduction : 0,
        other_deduction: entry ? entry.other_deduction : 0,
      }, workingDays, elapsedWorkingDays);

      branch.headcount++;
      branch.totalFixedGross += Number(emp.fixed_gross) || 0;
      branch.totalNet += calc.net;
      branch.totalPfEmployer += calc.pfEmployer;
      branch.totalEsiEmployer += calc.esiEmployer;
      branch.totalCTC += calc.totalMonthlyCTC;
      branch.employees.push({
        id: emp.id,
        employeeCode: emp.emp_code,
        name: emp.name,
        designation: emp.designation,
        net: calc.net,
      });
    }

    const branches = Array.from(branchMap.values()).map(b => ({
      location: b.location,
      officeName: b.officeName,
      headcount: b.headcount,
      totalFixedGross: b.totalFixedGross,
      totalNet: b.totalNet,
      averageNetPay: Math.round(b.totalNet / b.headcount),
      totalPfEmployer: b.totalPfEmployer,
      totalEsiEmployer: b.totalEsiEmployer,
      totalCTC: b.totalCTC,
      totalEmployerLiability: b.totalPfEmployer + b.totalEsiEmployer,
    }));

    const totalHeadcount = branches.reduce((acc, b) => acc + b.headcount, 0);
    const totalNetDisbursed = branches.reduce((acc, b) => acc + b.totalNet, 0);

    return {
      workingDays,
      summary: {
        totalBranches: branches.length,
        totalHeadcount,
        totalNetDisbursed,
        totalEmployerLiability: branches.reduce((acc, b) => acc + b.totalEmployerLiability, 0),
      },
      branches,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // COMPLETE REPORT — all views in one call (for dashboard summary)
  // ─────────────────────────────────────────────────────────────────
  async getFullReport(query) {
    const [payroll, attendance, statutory, branch, tourExpenses] = await Promise.all([
      this.getPayrollReport(query),
      this.getAttendanceReport(query),
      this.getStatutoryReport(query),
      this.getBranchReport(query),
      this.getTourExpenseReport(query),
    ]);

    return {
      metadata: {
        month: query.month,
        year: query.year,
        workingDays: payroll.workingDays,
        generatedAt: new Date().toISOString(),
      },
      payroll: { summary: payroll.summary, details: payroll.rows },
      attendance: { summary: attendance.summary, details: attendance.rows },
      statutory: { summary: statutory.summary, details: statutory.rows },
      branch: { summary: branch.summary, details: branch.branches },
      tourExpenses: { summary: tourExpenses.summary, details: tourExpenses.details },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // GET Tour Expense Report
  // ─────────────────────────────────────────────────────────────────
  async getTourExpenseReport({ month, year, office_id, search }) {
    const { Op } = require('sequelize');
    const { TourExpense, Employee, Office } = require('../models');

    let prevMonthYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevMonthYear = year - 1;
    }

    const monthStart = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-26`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-25`;

    const empWhere = {};
    if (office_id) empWhere.office_id = office_id;
    if (search) {
      empWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { emp_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const expenses = await TourExpense.findAll({
      where: {
        created_at: {
          [Op.gte]: monthStart,
          [Op.lte]: `${monthEnd} 23:59:59`
        }
      },
      include: [
        {
          model: Employee,
          as: 'employee',
          where: Object.keys(empWhere).length > 0 ? empWhere : undefined,
          include: [
            { model: Office, as: 'office', attributes: ['id', 'name', 'city'] }
          ],
        }
      ]
    });

    let totalClaims = 0;
    let totalAmount = 0;
    let approvedAmount = 0;
    let pendingAmount = 0;

    const details = expenses.map(exp => {
      const amount = Number(exp.amount) || 0;
      totalClaims++;
      totalAmount += amount;
      if (exp.status === 'approved') approvedAmount += amount;
      if (exp.status === 'pending') pendingAmount += amount;

      return {
        emp_code: exp.employee.emp_code,
        name: exp.employee.name,
        branch: exp.employee.office?.city || 'N/A',
        claim_code: exp.claim_code,
        purpose: exp.purpose,
        amount: amount,
        status: exp.status,
        date: exp.created_at
      };
    });

    return {
      summary: { totalClaims, totalAmount, approvedAmount, pendingAmount },
      details
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // AVAILABLE CYCLES — dynamic calendar from earliest cycle to today
  // ─────────────────────────────────────────────────────────────────
  async getAvailableCycles() {
    const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const now = new Date();
    const currentMonth = now.getMonth();       // 0-indexed
    const currentYear = now.getFullYear();

    // ── Fetch all existing cycles ──
    const cycles = await PayrollCycle.findAll({
      attributes: ['month', 'month_index', 'year', 'status', 'paid_on'],
      order: [['year', 'ASC'], ['month_index', 'ASC']],
      raw: true,
    });

    // Build lookup: "YYYY-M" → cycle info
    const cycleMap = new Map();
    for (const c of cycles) {
      cycleMap.set(`${c.year}-${c.month_index}`, c);
    }

    // ── Real calendar: start from the earliest cycle (or current month if none) ──
    let startYear, startMonth;
    if (cycles.length > 0) {
      startYear  = cycles[0].year;
      startMonth = cycles[0].month_index;
    } else {
      startYear  = currentYear;
      startMonth = currentMonth;
    }

    // ── Generate continuous month-by-month calendar up to the current month ──
    const calendar = [];
    let y = startYear;
    let m = startMonth;
    while (y < currentYear || (y === currentYear && m <= currentMonth)) {
      const key = `${y}-${m}`;
      const existing = cycleMap.get(key);

      calendar.push({
        month: `${MONTH_NAMES[m]} ${y}`,
        month_index: m,
        year: y,
        status: existing ? existing.status : (y === currentYear && m === currentMonth ? 'Draft' : 'N/A'),
        paid_on: existing ? existing.paid_on : null,
      });

      // Advance one month
      m++;
      if (m > 11) { m = 0; y++; }
    }

    // Return newest-first for the dropdown
    return calendar.reverse();
  }

  // ─────────────────────────────────────────────────────────────────
  // OFFICE LIST — for branch filter dropdown
  // ─────────────────────────────────────────────────────────────────
  async getOfficeList() {
    const offices = await Office.findAll({
      attributes: ['id', 'name', 'city'],
      order: [['name', 'ASC']],
    });
    return offices.map(o => ({ id: o.id, name: o.name, city: o.city }));
  }
}

module.exports = new ReportService();