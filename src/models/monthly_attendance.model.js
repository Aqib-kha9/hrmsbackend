const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MonthlyAttendance = sequelize.define('MonthlyAttendance', {
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
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 },
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  present_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  absent_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  late_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  half_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  holiday_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  weekend_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  tour_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Days the employee was on company tour (treated as paid/present)',
  },
  payable_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Calculated payable days (Req 2.5 A)',
  },
  lwp_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Leave Without Pay / Unpaid days (Req 2.5 A)',
  },
  paid_leaves_taken: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Paid leaves approved and taken (Req 2.5 A)',
  },
  total_leaves_taken: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Total leaves taken (Paid + LWP) (Req 2.5 A)',
  },
  weekly_off_worked_days: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Weekly off / Sunday days worked by employee (Req 2.5 D)',
  },
  remaining_leave_balance: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    comment: 'Remaining leave balance at monthly calculation time (Req 2.5 A)',
  },
  total_working_days: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  attendance_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
  },
}, {
  tableName: 'monthly_attendances',
  indexes: [
    { unique: true, fields: ['employee_id', 'month', 'year'] },
  ],
});

module.exports = MonthlyAttendance;