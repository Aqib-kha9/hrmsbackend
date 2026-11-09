const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AttendanceRecord = sequelize.define('AttendanceRecord', {
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('present', 'absent', 'late', 'half_day', 'weekend', 'holiday', 'tour'),
    allowNull: false,
  },
  check_in_time: {
    type: DataTypes.TIME,
    allowNull: true,
  },
  check_out_time: {
    type: DataTypes.TIME,
    allowNull: true,
  },
  total_hours: {
    type: DataTypes.DECIMAL(4, 2),
    allowNull: true,
  },
  total_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  late_by_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  early_exit_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  check_in_latitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    comment: 'GPS latitude at check-in',
  },
  check_in_longitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    comment: 'GPS longitude at check-in',
  },
  check_out_latitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    comment: 'GPS latitude at check-out',
  },
  check_out_longitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    comment: 'GPS longitude at check-out',
  },
  check_in_distance: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Distance from office at check-in (meters)',
  },
  check_out_distance: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Distance from office at check-out (meters)',
  },
  check_in_method: {
    type: DataTypes.STRING(50),
    defaultValue: 'web',
    comment: 'Method used for check-in (web, mobile, gps, biometric, outdoor, admin)',
  },
  is_outdoor: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether attendance is outdoor/field duty',
  },
  marked_by_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
    comment: 'Authorized admin/manager who marked on behalf',
  },
  check_in_photo: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  check_out_photo: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  overtime_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Overtime in minutes',
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  punch_in_office_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'offices', key: 'id' },
  },
  punch_out_office_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'offices', key: 'id' },
  },
  is_weekly_off_worked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether attendance was performed on an applicable weekly off or Sunday (Req 2.5 D)',
  },
  weekly_off_compensation: {
    type: DataTypes.ENUM('none', 'additional_payable_day', 'comp_off'),
    defaultValue: 'none',
    comment: 'Compensation treatment for working on weekly off / Sunday (Req 2.5 D)',
  },
}, {
  tableName: 'attendance_records',
  indexes: [
    { unique: true, fields: ['employee_id', 'date'] },
    { fields: ['date'] },
    { fields: ['status'] },
  ],
});

module.exports = AttendanceRecord;