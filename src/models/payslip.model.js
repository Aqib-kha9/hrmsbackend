const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Payslip = sequelize.define('Payslip', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'employees', key: 'id' },
  },
  month: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'e.g. "June 2024"',
  },
  month_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 },
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  basic_salary: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  gross_salary: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  net_salary: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  total_deductions: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  pf_employee: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  pf_employer: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  esi_employee: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'ESIC employee contribution (0.75%)',
  },
  esi_employer: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'ESIC employer contribution (3.25%)',
  },
  professional_tax: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Professional Tax',
  },
  // Allowance breakdown
  hra: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'House Rent Allowance',
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
    comment: 'Performance allowance (Req 2.4)',
  },
  // Attendance-based fields
  working_days: {
    type: DataTypes.INTEGER,
    defaultValue: 26,
    comment: 'Total working days in the month',
  },
  paid_days: {
    type: DataTypes.INTEGER,
    defaultValue: 26,
    comment: 'Days actually paid (working - LOP)',
  },
  lop_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Loss of Pay days',
  },
  // CTC
  ctc: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Monthly CTC = gross + employer contributions',
  },
  annual_ctc: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: 'Annual CTC = Monthly CTC * 12 (Req 2.4)',
  },
  status: {
    type: DataTypes.ENUM('draft', 'processed', 'paid'),
    defaultValue: 'processed',
  },
  paid_on: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'payslips',
  indexes: [
    { unique: true, fields: ['employee_id', 'month_index', 'year'] },
    { fields: ['status'] },
  ],
});

module.exports = Payslip;