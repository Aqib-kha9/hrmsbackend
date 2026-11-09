const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Letter = sequelize.define('Letter', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // ── Nullable to support prospective candidates who are not yet employees (Req 12.4) ──
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
  },
  // Candidate-specific details when employee_id is null
  candidate_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  candidate_email: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  candidate_phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  type: {
    type: DataTypes.ENUM('offer', 'appointment', 'promotion', 'transfer', 'resignation', 'experience', 'relieving', 'warning', 'form16'),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  issued_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  issued_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'employees', key: 'id' },
  },
  signatory_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'authorised_signatories', key: 'id' },
    comment: 'Authorized signatory selected for this letter (Req 12.3 & 13)',
  },
  pdf_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Custom compensation breakup or letter fields',
  },
  status: {
    type: DataTypes.ENUM('draft', 'issued', 'acknowledged', 'revoked'),
    defaultValue: 'draft',
  },
  acknowledged_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'letters',
  timestamps: true,
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['type'] },
    { fields: ['status'] },
    { fields: ['candidate_email'] },
  ],
});

module.exports = Letter;