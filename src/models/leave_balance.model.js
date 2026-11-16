const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LeaveBalance = sequelize.define('LeaveBalance', {
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
  year: {
    type: DataTypes.INTEGER,
    defaultValue: () => new Date().getFullYear(),
    comment: 'Calendar/Entitlement year (e.g. 2026)',
  },
  // ── Privilege / Earned Leave (PL / EL): 12 days per year, carry forward permitted ──
  pl_allocated: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 12.00,
    comment: 'Annual Privilege / Earned Leave (PL/EL) allocation (12 days/year)',
  },
  pl_carried_forward: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Privilege / Earned Leave carried forward from previous year',
  },
  pl_used: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Privilege / Earned Leave days consumed in the year',
  },
  pl_lapsed: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Privilege / Earned Leave days lapsed in excess of carry-forward policy',
  },
  // ── Earned Leave (EL): Merged with PL ──
  el_allocated: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Earned Leave allocation (merged with PL into PL/EL)',
  },
  el_carried_forward: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Earned Leave carried forward (merged with PL)',
  },
  el_used: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Earned Leave days consumed (merged with PL)',
  },
  el_lapsed: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Earned Leave days lapsed (merged with PL)',
  },
  // ── Casual Leave (CL): 12 days per year, lapses annually ──
  cl_allocated: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 12.00,
    comment: 'Annual Casual Leave allocation (12 days/year)',
  },
  cl_carried_forward: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Casual Leave carried forward (always 0.00, CL lapses annually)',
  },
  cl_used: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Casual Leave days consumed in the year',
  },
  cl_lapsed: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Casual Leave days lapsed at year-end',
  },
  // ── Compensatory Off (Comp-Off): Earned for Sunday / Weekly Off worked (Req 2.5 D) ──
  comp_off_balance: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Compensatory off days earned from weekly-off / holiday working (Req 2.5 D)',
  },
  // ── Legacy fields for backward compatibility ──
  available: {
    type: DataTypes.INTEGER,
    defaultValue: 24,
    comment: 'Legacy available leave balance (12 PL/EL + 12 CL = 24 days)',
  },
  used: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Legacy used leaves',
  },
  admin_granted: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Extra leaves granted by admin',
  },
  lapsed: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Total lapsed leaves',
  },
  last_accrual_month: {
    type: DataTypes.STRING(7),
    allowNull: true,
    comment: 'YYYY-MM of last monthly check/accrual',
  },
  consecutive_no_usage_months: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Legacy tracker',
  },
}, {
  tableName: 'leave_balances',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['employee_id'] },
  ],
});

module.exports = LeaveBalance;