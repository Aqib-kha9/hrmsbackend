const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LeaveRequest = sequelize.define('LeaveRequest', {
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
  leave_type: {
    type: DataTypes.STRING(20),
    defaultValue: 'cl',
    comment: 'pl = Privilege Leave (12/yr), el = Earned Leave (12/yr), cl = Casual Leave (12/yr), lwp = Leave Without Pay, comp_off = Compensatory Off, other = Other',
  },
  from_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  to_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  duration: {
    type: DataTypes.DECIMAL(4, 1),
    defaultValue: 1.0,
    comment: 'Number of leave days (supports 0.5 for half day)',
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  contact_during_leave: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'cancelled'),
    defaultValue: 'pending',
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Remarks by approver',
  },
  // ── Manual Payroll Control & Decoupling (Req 4.3 & 10) ──
  is_paid: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether this leave is paid or loss of pay',
  },
  payroll_treatment: {
    type: DataTypes.ENUM('pending', 'paid', 'unpaid', 'adjusted_balance', 'deducted_current', 'carry_forward_next'),
    defaultValue: 'pending',
    comment: 'Admin payroll control: how this leave was treated in payroll',
  },
  payroll_adjusted_month: {
    type: DataTypes.STRING(7),
    allowNull: true,
    comment: 'YYYY-MM when this leave was adjusted/deducted in payroll',
  },
}, {
  tableName: 'leave_requests',
  timestamps: true,
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['status'] },
    { fields: ['leave_type'] },
    { fields: ['from_date', 'to_date'] },
  ],
});

module.exports = LeaveRequest;