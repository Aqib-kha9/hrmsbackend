const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AttendanceRegularization = sequelize.define('AttendanceRegularization', {
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
  attendance_record_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'attendance_records', key: 'id' },
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  regularization_type: {
    type: DataTypes.ENUM(
      'forgot_punch',        // Missed Punch (Forgot both Check-In & Check-Out)
      'forgot_check_in',     // Forgot to punch in
      'forgot_check_out',    // Forgot to punch out
      'on_duty',             // On Duty / Client / Field Visit
      'wfh',                 // Work From Home / Remote
      'technical_issue',     // Device / GPS / App issue
      'other'                // Other reason
    ),
    defaultValue: 'forgot_punch',
    allowNull: false,
  },
  requested_check_in: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Proposed check-in time e.g. 09:30:00',
  },
  requested_check_out: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Proposed check-out time e.g. 18:30:00',
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Detailed reason provided by employee',
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'cancelled'),
    defaultValue: 'pending',
    allowNull: false,
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
  admin_remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Remarks or feedback from HR / Manager upon reviewing',
  },
}, {
  tableName: 'attendance_regularizations',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['date'] },
    { fields: ['status'] },
  ],
});

module.exports = AttendanceRegularization;
