const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PayrollEntry = sequelize.define('PayrollEntry', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  cycle_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'payroll_cycles', key: 'id' },
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'employees', key: 'id' },
  },
  absent_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // ── Manual Payroll Adjustments & Administrative Control (Req 4.1 & 4.2) ──
  leave_adjustment_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Manual leave deduction adjustment in current month (e.g. adjust 2 days out of 4 taken)',
  },
  leave_carry_forward_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Leave days carried forward for adjustment in the following month',
  },
  manual_payable_days: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Direct Admin override for payable days (if set, overrides auto calculation)',
  },
  total_muster_days: {
    type: DataTypes.INTEGER,
    defaultValue: 30,
    comment: 'Total calendar/muster days in the cycle period',
  },
  present_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Actual days present during the period',
  },
  paid_leave_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Approved paid leave days during the period',
  },
  lwp_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Loss of Pay / Unpaid leave days during the period',
  },
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Admin/Owner rationale for manual payroll adjustments',
  },
  bonus: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  previous_arrears: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  incentive: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  loan_deduction: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  other_deduction: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('Draft', 'Verified', 'Paid', 'Pending Audit'),
    defaultValue: 'Draft',
    allowNull: false,
  },
}, {
  tableName: 'payroll_entries',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['cycle_id', 'employee_id'] },
    { fields: ['status'] },
  ],
});

module.exports = PayrollEntry;