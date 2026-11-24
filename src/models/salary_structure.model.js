const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SalaryStructure = sequelize.define('SalaryStructure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'employees',
      key: 'id',
    },
  },
  // Wage Code & Calculation Basis
  calculation_basis: {
    type: DataTypes.ENUM('CTC', 'Gross', 'Net Take Home'),
    defaultValue: 'CTC',
    comment: 'CTC, Gross, or Net Take Home basis for calculation',
  },
  state: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'State for Minimum Wages & PT lookup (e.g. MP, Lucknow, Rajsthan, Nagpur)',
  },
  wages_category: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Unskilled, Semi-skilled, Skilled, Highly Skilled',
  },
  minimum_wage: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Statutory minimum wage monthly floor',
  },
  basic_pct: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.50,
    comment: 'Wage Code standard: Basic should be at least 50% of CTC',
  },
  hra_pct: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.40,
    comment: 'Metro = 50%, Non-metro = 40%',
  },

  // Gross & salary breakup
  fixed_gross: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  basic_salary: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  hra: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  special_allowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Balancing allowance (Gross - Basic - HRA - Other Fixed)',
  },
  other_allowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  conveyance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  medical_allowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  performance_allowance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Performance allowance and incentive component',
  },
  annual_ctc: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Annual Cost to Company (Monthly CTC × 12)',
  },

  // Statutory flags & Rules
  hra_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  pf_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  pf_ceiling: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  pf_wage_limit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 25000,
    comment: 'PF wage ceiling limit in INR/month (0 = no limit)',
  },
  pf_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
  },
  pf_employee_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.12,
  },
  pf_employer_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.13,
    comment: 'Default 13% (12% EPF + 1% Admin/EDLI)',
  },

  // ESIC Configuration
  esic_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  esic_calc_base: {
    type: DataTypes.ENUM('Basic', 'Gross'),
    defaultValue: 'Basic',
    comment: 'Whether ESIC is computed on Basic or Gross',
  },
  esic_wage_limit: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 21000,
    comment: 'ESIC wage ceiling limit (Gross <= 21000)',
  },
  esic_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
  },
  esic_employee_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0075,
  },
  esic_employer_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0325,
  },

  // Gratuity Configuration
  gratuity_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  gratuity_pct: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0481,
    comment: 'Standard 4.81% on Basic',
  },
  gratuity_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Annual Gratuity amount',
  },

  // Bonus Configuration (Payment of Bonus Act)
  bonus_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  bonus_pct: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0833,
    comment: 'Statutory bonus rate (minimum 8.33% - maximum 20%)',
  },
  statutory_bonus: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Statutory bonus for Basic <= 21k/month',
  },
  exgratia_bonus: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Exgratia bonus for Basic > 21k/month',
  },

  // Professional Tax & Other Deductions
  pt_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  pt_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly Professional Tax',
  },
  tds_monthly: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly TDS / Income Tax deduction',
  },
  lwf_monthly: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly Labour Welfare Fund deduction',
  },
  loan_emi_monthly: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly Loan EMI deduction',
  },
  other_deductions_monthly: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Any other recurring monthly deduction',
  },

  // Final Net Take Home & Current Benchmark
  net_take_home: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Net monthly take-home salary',
  },
  current_take_home: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Previous/Current in-hand benchmark for comparison',
  },

  // LOP configuration
  effective_work_days: {
    type: DataTypes.INTEGER,
    defaultValue: 26,
    comment: 'Total working days in a month for LOP calculation',
  },
  // Validity
  effective_from: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  effective_to: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'NULL means currently active',
  },
  // Audit
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'salary_structures',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['effective_from'] },
  ],
});

module.exports = SalaryStructure;
