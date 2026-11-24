const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MinimumWage = sequelize.define('MinimumWage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  state: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'State or region (e.g. MP, Lucknow, Rajsthan, Nagpur)',
  },
  wages_category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Unskilled, Semi-skilled, Skilled, Highly Skilled',
  },
  monthly_wage: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Statutory minimum wage per month in INR',
  },
  remark: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'e.g. From October 2026',
  },
  effective_from: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'minimum_wages',
  timestamps: true,
  indexes: [
    { fields: ['state', 'wages_category'], unique: true },
    { fields: ['state'] },
  ],
});

module.exports = MinimumWage;
