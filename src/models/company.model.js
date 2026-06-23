const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
    unique: true,
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  website: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  state: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'companies',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['is_active'] },
  ],
});

module.exports = Company;