const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

const LetterTemplate = sequelize.define('LetterTemplate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('offer', 'appointment', 'promotion', 'transfer', 'resignation', 'experience', 'relieving', 'warning', 'form16'),
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'e.g. Hiring, Disciplinary, General, Exit',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  content: {
    type: DataTypes.TEXT('long'),
    allowNull: false,
    comment: 'HTML template with placeholders like [Employee_Name], [Job_Title], etc.',
  },
  variant_count: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
    allowNull: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Admin employee ID who created/updated this template',
  },
}, {
  tableName: 'letter_templates',
  timestamps: true,
  paranoid: false,
  indexes: [
    { fields: ['type'] },
    { fields: ['category'] },
    { fields: ['is_active'] },
  ],
});

module.exports = LetterTemplate;