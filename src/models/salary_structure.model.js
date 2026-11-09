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
    comment: 'Performance allowance and incentive component (Req 2.4)',
  },
  annual_ctc: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Annual Cost to Company (Monthly CTC × 12)',
  },
  // Statutory flags
  hra_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether HRA is enabled for this employee (Req 2.4)',
  },
  pf_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  pf_ceiling: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'If true, PF calculated on min(basic, 15000)',
  },
  // PF & ESIC contribution mode + rate configuration (Phase 8)
  pf_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
    comment: 'Who pays PF — shared (default), employee_only, employer_only, or none',
  },
  pf_employee_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.12,
    comment: 'Employee PF contribution rate (e.g., 0.12 = 12%)',
  },
  pf_employer_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.12,
    comment: 'Employer PF contribution rate (e.g., 0.12 = 12%)',
  },
  esic_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
    comment: 'Who pays ESIC — none, employee_only, employer_only, or shared',
  },
  esic_employee_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0075,
    comment: 'Employee ESIC contribution rate (e.g., 0.0075 = 0.75%)',
  },
  esic_employer_rate: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.0325,
    comment: 'Employer ESIC contribution rate (e.g., 0.0325 = 3.25%)',
  },
  esic_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  pt_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
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