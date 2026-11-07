const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Tour model — tracks company tours assigned to employees by Admin/HR.
 *
 * When a tour is created, the system automatically marks attendance records
 * with status = 'tour' for every day in the date range (excluding weekends &
 * holidays which keep their own status). Tour days are treated as PAID
 * (like present) for payroll — they are NOT counted as absent.
 */
const Tour = sequelize.define('Tour', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  tour_code: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true,
    comment: 'Human-readable unique code, e.g. TOUR-2026-0001',
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'employees', key: 'id' },
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: 'Short title / purpose of the tour',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Detailed tour description / agenda',
  },
  from_location: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  to_location: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    validate: {
      isAfterStartDate(value) {
        if (value && this.start_date && value < this.start_date) {
          throw new Error('end_date must be on or after start_date');
        }
      },
    },
  },
  status: {
    type: DataTypes.ENUM('active', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'active',
    comment: 'active = ongoing/upcoming, completed = finished, cancelled = revoked',
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
    comment: 'Admin/HR who created the tour',
  },
  cancelled_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
  },
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  cancel_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'tours',
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['start_date', 'end_date'] },
    { fields: ['status'] },
    { fields: ['tour_code'] },
  ],
});

module.exports = Tour;
