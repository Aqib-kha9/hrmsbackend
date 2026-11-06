const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Permission = sequelize.define('Permission', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  module: {
    type: DataTypes.STRING(50),
    allowNull: false, // DASHBOARD, EMPLOYEES, ONBOARDING, ATTENDANCE, LOCATIONS, LEAVE, PAYROLL, LOANS, PERFORMANCE, LETTERS, TOUR_EXPENSES, REPORTS, SETTINGS, ROLE_MGMT
  },
  action: {
    type: DataTypes.STRING(20),
    allowNull: false, // CREATE, READ, UPDATE, DELETE, APPROVE, EXPORT
  },
  slug: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true, // e.g. employees:read, payroll:approve
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'permissions',
  timestamps: true,
  underscored: true,
});

module.exports = Permission;
