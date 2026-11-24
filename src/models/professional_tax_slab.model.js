const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProfessionalTaxSlab = sequelize.define('ProfessionalTaxSlab', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  state: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Full state name, e.g. Madhya Pradesh, Maharashtra',
  },
  state_short: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Short code, e.g. MP, MH',
  },
  is_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  gender: {
    type: DataTypes.ENUM('All', 'Male', 'Female'),
    defaultValue: 'All',
  },
  salary_from: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  salary_to: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'NULL indicates & Above',
  },
  monthly_tax: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  yearly_tax: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'professional_tax_slabs',
  timestamps: true,
  indexes: [
    { fields: ['state', 'gender'] },
    { fields: ['state_short'] },
  ],
});

module.exports = ProfessionalTaxSlab;
