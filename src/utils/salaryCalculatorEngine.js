/**
 * salaryCalculatorEngine.js
 * 
 * New Labour / Wage Code Compliant CTC Structure & Payroll Engine.
 * 100% mathematically aligned with the client's master payroll calculators:
 * - Final_CTC_Structure_Calculator_Exgratia.xlsx
 * - Final_CTC_Structure_Calculator_Exgretia_Horizontal-1=.xlsx
 */

function round2(val) {
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Standard Professional Tax slabs lookup (Fallback if DB slabs not provided)
 */
const DEFAULT_PT_SLABS = [
  // Madhya Pradesh
  { state: 'Madhya Pradesh', stateShort: 'MP', gender: 'All', from: 0, to: 18750, monthly: 0 },
  { state: 'Madhya Pradesh', stateShort: 'MP', gender: 'All', from: 18751, to: 25000, monthly: 125 },
  { state: 'Madhya Pradesh', stateShort: 'MP', gender: 'All', from: 25001, to: 33333, monthly: 166.67 },
  { state: 'Madhya Pradesh', stateShort: 'MP', gender: 'All', from: 33334, to: Infinity, monthly: 208.33 },

  // Maharashtra
  { state: 'Maharashtra', stateShort: 'MH', gender: 'Male', from: 0, to: 7500, monthly: 0 },
  { state: 'Maharashtra', stateShort: 'MH', gender: 'Male', from: 7501, to: 10000, monthly: 175 },
  { state: 'Maharashtra', stateShort: 'MH', gender: 'Male', from: 10001, to: Infinity, monthly: 208.33 },
  { state: 'Maharashtra', stateShort: 'MH', gender: 'Female', from: 0, to: 25000, monthly: 0 },
  { state: 'Maharashtra', stateShort: 'MH', gender: 'Female', from: 25001, to: Infinity, monthly: 208.33 },
];

/**
 * Calculate Monthly Professional Tax based on State, Gender, and Monthly Gross
 */
function calculateProfessionalTax(monthlyGross, state = 'MP', gender = 'All', customSlabs = null) {
  if (!state) return 0;
  const cleanState = state.trim().toUpperCase();
  const cleanGender = (gender || 'All').trim().toLowerCase();
  const slabs = customSlabs || DEFAULT_PT_SLABS;

  const gross = Number(monthlyGross) || 0;

  // Filter slabs for this state
  const stateSlabs = slabs.filter((s) => {
    const sName = (s.state || '').toUpperCase();
    const sShort = (s.state_short || s.stateShort || '').toUpperCase();
    return sName === cleanState || sShort === cleanState || cleanState.includes(sShort);
  });

  if (!stateSlabs || stateSlabs.length === 0) {
    return 0; // State without PT (DL, HR, UP, RJ, etc.)
  }

  // Find matching bracket
  for (const slab of stateSlabs) {
    const slabGender = (slab.gender || 'All').toLowerCase();
    const genderMatches = slabGender === 'all' || slabGender === cleanGender;
    if (!genderMatches) continue;

    const from = Number(slab.salary_from ?? slab.from ?? 0);
    const to = slab.salary_to === null || slab.salary_to === undefined || slab.to === Infinity
      ? Infinity
      : Number(slab.salary_to ?? slab.to);

    if (gross >= from && gross <= to) {
      return Number(slab.monthly_tax ?? slab.monthly ?? 0);
    }
  }

  return 0;
}

/**
 * Pure Forward Salary Calculator given CTC
 */
function computeSalaryFromCTC(ctcAnnual, params = {}) {
  const ctc = Math.max(0, Number(ctcAnnual) || 0);

  // Configuration & Defaults
  const basicPct = params.basicPct !== undefined ? Number(params.basicPct) : 0.50;
  const hraPct = params.hraPct !== undefined ? Number(params.hraPct) : 0.40;
  const monthlyMinWage = Math.max(0, Number(params.minimumWage) || 0);
  const annualMinWage = monthlyMinWage * 12;

  // PF Rules
  const pfApplicable = params.pfApplicable === true || params.pfApplicable === 'Yes';
  const pfWageLimit = params.pfWageLimit !== undefined ? Number(params.pfWageLimit) : 25000; // 0 = no limit
  const employerPfPct = params.employerPfPct !== undefined ? Number(params.employerPfPct) : 0.13; // 13% default
  const employeePfPct = params.employeePfPct !== undefined ? Number(params.employeePfPct) : 0.12; // 12% default

  // ESIC Rules
  const esicApplicable = params.esicApplicable === true || params.esicApplicable === 'Yes';
  const esicCalcBase = (params.esicCalcBase || 'Basic').toLowerCase() === 'gross' ? 'Gross' : 'Basic';
  const esicWageLimit = params.esicWageLimit !== undefined ? Number(params.esicWageLimit) : 21000;
  const employerEsicPct = params.employerEsicPct !== undefined ? Number(params.employerEsicPct) : 0.0325;
  const employeeEsicPct = params.employeeEsicPct !== undefined ? Number(params.employeeEsicPct) : 0.0075;

  // Gratuity Rules
  const gratuityApplicable = params.gratuityApplicable !== false && params.gratuityApplicable !== 'No';
  const gratuityPct = params.gratuityPct !== undefined ? Number(params.gratuityPct) : 0.0481;

  // Bonus Rules (Payment of Bonus Act)
  const bonusApplicable = params.bonusApplicable === true || params.bonusApplicable === 'Yes';
  const bonusPct = params.bonusPct !== undefined ? Number(params.bonusPct) : 0.0833;

  // Step 1: Basic Salary (New Wage Code 50% vs Minimum Wage floor)
  const basicByCTC = ctc * basicPct;
  const basicAnnual = Math.max(basicByCTC, annualMinWage);
  const basicMonthly = basicAnnual / 12;
  const basicCalculatedOn = annualMinWage > basicByCTC ? 'Minimum Wage' : '% of CTC';

  // Step 2: Employer PF
  let employerPf = 0;
  let employeePf = 0;
  if (pfApplicable) {
    const pfBase = pfWageLimit > 0 ? Math.min(basicAnnual, pfWageLimit * 12) : basicAnnual;
    employerPf = round2(pfBase * employerPfPct);
    employeePf = round2(pfBase * employeePfPct);
  }

  // Step 3: Gratuity
  const gratuity = gratuityApplicable ? round2(basicAnnual * gratuityPct) : 0;

  // Step 4: Bonus (Statutory <= 21k/mo vs Exgratia > 21k/mo)
  let statutoryBonus = 0;
  let exgratiaBonus = 0;
  if (bonusApplicable) {
    if (basicMonthly <= 21000) {
      statutoryBonus = round2(Math.max(7000, monthlyMinWage) * 12 * bonusPct);
    } else {
      exgratiaBonus = round2(basicAnnual * bonusPct);
    }
  }

  // Step 5: Employer & Employee ESIC + Gross Salary
  let employerEsic = 0;
  let employeeEsic = 0;
  let grossAnnual = 0;

  const otherEmployerCosts = employerPf + gratuity + statutoryBonus + exgratiaBonus;

  if (!esicApplicable) {
    grossAnnual = round2(ctc - otherEmployerCosts);
  } else {
    if (esicCalcBase === 'Basic') {
      const esicBase = esicWageLimit > 0 ? Math.min(basicAnnual, esicWageLimit * 12) : basicAnnual;
      employerEsic = round2(esicBase * employerEsicPct);
      employeeEsic = round2(esicBase * employeeEsicPct);
      grossAnnual = round2(ctc - otherEmployerCosts - employerEsic);
    } else {
      // Base = Gross: Gross * (1 + employerEsicPct) = ctc - otherEmployerCosts
      const rawGross = (ctc - otherEmployerCosts) / (1 + employerEsicPct);
      const esicBase = esicWageLimit > 0 ? Math.min(rawGross, esicWageLimit * 12) : rawGross;
      employerEsic = round2(esicBase * employerEsicPct);
      employeeEsic = round2(esicBase * employeeEsicPct);
      grossAnnual = round2(ctc - otherEmployerCosts - employerEsic);
    }
  }

  const grossMonthly = grossAnnual / 12;

  // Step 6: HRA, Other Fixed & Special Allowance (Balancing)
  const inputOtherFixed = params.otherFixedAllowances ? Number(params.otherFixedAllowances) : 0;
  const otherFixedAnnual = params.isOtherFixedMonthly ? inputOtherFixed * 12 : inputOtherFixed;

  const hraAnnual = round2(Math.max(0, Math.min(basicAnnual * hraPct, Math.max(0, grossAnnual - basicAnnual))));
  const otherFixedAllocated = round2(Math.max(0, Math.min(otherFixedAnnual, Math.max(0, grossAnnual - basicAnnual - hraAnnual))));
  const specialAllowanceAnnual = round2(grossAnnual - basicAnnual - hraAnnual - otherFixedAllocated);
  const isSpecialAllowanceNegative = specialAllowanceAnnual < 0;

  // Step 7: Professional Tax & Monthly Deductions
  const ptMonthly = params.ptAmount !== undefined
    ? Number(params.ptAmount)
    : calculateProfessionalTax(grossMonthly, params.state, params.gender, params.customPtSlabs);
  const ptAnnual = round2(ptMonthly * 12);

  const tdsMonthly = Number(params.tdsMonthly) || 0;
  const lwfMonthly = Number(params.lwfMonthly) || 0;
  const loanEmiMonthly = Number(params.loanEmiMonthly) || 0;
  const otherDeductionsMonthly = Number(params.otherDeductionsMonthly) || 0;

  const employeeDeductionsAnnual = round2(
    employeePf +
    employeeEsic +
    ptAnnual +
    (tdsMonthly * 12) +
    (lwfMonthly * 12) +
    (loanEmiMonthly * 12) +
    (otherDeductionsMonthly * 12)
  );

  const netTakeHomeAnnual = round2(grossAnnual - employeeDeductionsAnnual);
  const netTakeHomeMonthly = round2(netTakeHomeAnnual / 12);

  const currentTakeHome = Number(params.currentTakeHome) || 0;
  const differenceInTakeHome = currentTakeHome > 0 ? round2(netTakeHomeMonthly - currentTakeHome) : 0;

  return {
    // Annual Figures
    annual: {
      ctc: round2(ctc),
      basic: round2(basicAnnual),
      hra: round2(hraAnnual),
      otherFixed: round2(otherFixedAllocated),
      specialAllowance: round2(specialAllowanceAnnual),
      gross: round2(grossAnnual),
      employerPf: round2(employerPf),
      employerEsic: round2(employerEsic),
      gratuity: round2(gratuity),
      statutoryBonus: round2(statutoryBonus),
      exgratiaBonus: round2(exgratiaBonus),
      totalEmployerBenefits: round2(otherEmployerCosts + employerEsic),
      employeePf: round2(employeePf),
      employeeEsic: round2(employeeEsic),
      pt: round2(ptAnnual),
      tds: round2(tdsMonthly * 12),
      lwf: round2(lwfMonthly * 12),
      loanEmi: round2(loanEmiMonthly * 12),
      otherDeductions: round2(otherDeductionsMonthly * 12),
      totalDeductions: round2(employeeDeductionsAnnual),
      netTakeHome: round2(netTakeHomeAnnual),
    },

    // Monthly Figures
    monthly: {
      ctc: round2(ctc / 12),
      basic: round2(basicMonthly),
      hra: round2(hraAnnual / 12),
      otherFixed: round2(otherFixedAllocated / 12),
      specialAllowance: round2(specialAllowanceAnnual / 12),
      gross: round2(grossMonthly),
      employerPf: round2(employerPf / 12),
      employerEsic: round2(employerEsic / 12),
      gratuity: round2(gratuity / 12),
      statutoryBonus: round2(statutoryBonus / 12),
      exgratiaBonus: round2(exgratiaBonus / 12),
      employeePf: round2(employeePf / 12),
      employeeEsic: round2(employeeEsic / 12),
      pt: round2(ptMonthly),
      tds: round2(tdsMonthly),
      lwf: round2(lwfMonthly),
      loanEmi: round2(loanEmiMonthly),
      otherDeductions: round2(otherDeductionsMonthly),
      totalDeductions: round2(employeeDeductionsAnnual / 12),
      netTakeHome: round2(netTakeHomeMonthly),
    },

    // Meta & Compliance Info
    meta: {
      calculationBasis: params.basis || 'CTC',
      inputAmount: Number(params.amount) || 0,
      state: params.state || 'MP',
      wagesCategory: params.wagesCategory || 'Skilled',
      monthlyMinimumWage: round2(monthlyMinWage),
      basicCalculatedOn,
      isSpecialAllowanceNegative,
      pfApplicable,
      pfWageLimit,
      esicApplicable,
      esicCalcBase,
      bonusApplicable,
      gratuityApplicable,
      currentTakeHome: round2(currentTakeHome),
      differenceInTakeHome: round2(differenceInTakeHome),
    },
  };
}

/**
 * High-Precision Binary Search Solver
 * Derives exact CTC when input basis is "Gross" or "Net Take Home"
 */
function solveCTCFromTarget(targetAnnualAmount, basis = 'Gross', params = {}) {
  const target = Math.max(0, Number(targetAnnualAmount) || 0);
  if (target === 0) return 0;

  let low = target * 0.5;
  let high = target * 3.0;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const res = computeSalaryFromCTC(mid, params);
    const achieved = basis === 'Net Take Home' ? res.annual.netTakeHome : res.annual.gross;

    if (achieved < target) {
      low = mid;
    } else {
      high = mid;
    }

    if (Math.abs(achieved - target) < 0.005) {
      break;
    }
  }

  return (low + high) / 2;
}

/**
 * Universal Master Salary Calculator
 * Accepts any basis: 'CTC', 'Gross', or 'Net Take Home'
 */
function calculateSalaryStructure(inputParams = {}) {
  const basis = inputParams.basis || 'CTC';
  const rawAmount = Number(inputParams.amount) || 0;
  const isMonthly = inputParams.isMonthly !== undefined
    ? inputParams.isMonthly
    : rawAmount <= 100000; // Auto-detect: <= 100k implies monthly

  const annualTarget = isMonthly ? rawAmount * 12 : rawAmount;

  let finalAnnualCTC = annualTarget;

  if (basis === 'Gross' || basis === 'Net Take Home') {
    finalAnnualCTC = solveCTCFromTarget(annualTarget, basis, inputParams);
  }

  return computeSalaryFromCTC(finalAnnualCTC, {
    ...inputParams,
    basis,
    amount: rawAmount,
  });
}

module.exports = {
  round2,
  calculateProfessionalTax,
  calculateSalaryStructure,
  computeSalaryFromCTC,
  solveCTCFromTarget,
  DEFAULT_PT_SLABS,
};
