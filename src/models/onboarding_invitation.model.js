const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const OnboardingInvitation = sequelize.define('OnboardingInvitation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  token: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    index: true,
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: false,
    validate: { isEmail: true },
  },
  candidate_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  designation: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  department: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  office_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'offices', key: 'id' },
  },
  company_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'companies', key: 'id' },
  },
  fixed_gross: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('pending', 'submitted', 'approved', 'expired', 'rejected'),
    defaultValue: 'pending',
    allowNull: false,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  submitted_data: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Self-submitted onboarding data including personal, bank, statutory & doc URLs',
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
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
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'onboarding_invitations',
  timestamps: true,
  indexes: [
    { fields: ['token'] },
    { fields: ['email'] },
    { fields: ['status'] },
  ],
});

module.exports = OnboardingInvitation;
