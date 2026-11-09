const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  emp_code: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(150),
    unique: true,
    allowNull: false,
    validate: { isEmail: true },
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  designation: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  department: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  hr_manager: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Assigned HR Manager / Reporting Manager name',
  },
  role_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'roles',
      key: 'id',
    },
  },
  role: {
    type: DataTypes.STRING(50),
    defaultValue: 'employee',
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'suspended', 'resigned'),
    defaultValue: 'active',
    allowNull: false,
  },
  date_of_joining: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  date_of_birth: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  gender: {
    type: DataTypes.ENUM('male', 'female', 'other'),
    allowNull: true,
  },
  marital_status: {
    type: DataTypes.ENUM('married', 'unmarried', 'other'),
    allowNull: true,
    defaultValue: 'unmarried',
    comment: 'Marital status (married, unmarried, other)',
  },
  father_or_husband_name: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: "Father's name or Husband's name as applicable",
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  shift_start_time: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Shift start time (e.g., 09:00:00)',
  },
  shift_end_time: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Shift end time (e.g., 18:00:00)',
  },
  is_rotational_shift: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Identifies if employee works on rotational shifts',
  },
  rotational_weekly_off: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether employee has rotational weekly off schedule (Req 2.5 C)',
  },
  weekly_off_type: {
    type: DataTypes.ENUM('fixed', 'rotational'),
    allowNull: false,
    defaultValue: 'fixed',
    comment: 'Weekly off type: fixed or rotational (Req 2.5 C)',
  },
  weekly_off_days: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: ['Sunday'],
    comment: 'Configured weekly off day names, e.g. ["Sunday"], ["Monday"], etc. (Req 2.5 C)',
  },
  half_day_late_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 60,
    comment: 'Minutes late after which attendance is marked as half day',
  },
  profile_image: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  company_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'companies', key: 'id' },
    comment: 'Parent company — enables multi-company hierarchy',
  },
  office_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'offices', key: 'id' },
  },
  fixed_gross: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0,
    comment: 'Fixed monthly gross salary, used as base for payroll calculation',
  },
  basic_salary: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0,
    comment: 'Legacy field — prefer fixed_gross for payroll ledger calculations',
  },
  performance_allowance: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0,
    comment: 'Performance allowance component (Req 2.4)',
  },
  annual_ctc: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: 0,
    comment: 'Annual Cost to Company (Req 2.4)',
  },
  hra_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether HRA is enabled for this employee (Req 2.4)',
  },
  pf_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether Provident Fund is applicable for this employee',
  },
  pf_ceiling: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether PF is capped at ₹15,000 basic ceiling',
  },
  pf_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
    comment: 'Who pays PF — shared (default), employee_only, employer_only, or none',
  },
  esic_applicable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether ESIC is applicable for this employee',
  },
  esic_contribution_mode: {
    type: DataTypes.ENUM('none', 'employee_only', 'employer_only', 'shared'),
    defaultValue: 'shared',
    comment: 'Who pays ESIC — none, employee_only, employer_only, or shared',
  },
  // Bank details
  bank_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Bank name for salary disbursement',
  },
  bank_account_number: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'Bank account number (encrypted/hashed at app level)',
  },
  ifsc_code: {
    type: DataTypes.STRING(15),
    allowNull: true,
    comment: 'IFSC code for NEFT/RTGS',
  },
  // Statutory identifiers
  pan_number: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'Permanent Account Number',
  },
  aadhaar_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '12-digit Aadhaar Card Number',
  },
  pf_number: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'PF account number',
  },
  pf_employment_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'PF employment/enrollment date',
  },
  uan: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Universal Account Number (UAN)',
  },
  esic_number: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'ESIC IP Number / Registration Number',
  },
  // Location & legal entity
  location: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Work location / city',
  },
  company_name: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Legal entity name for multi-company setups',
  },
  // Emergency contact details
  emergency_contact_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Emergency contact person name',
  },
  emergency_contact_phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Emergency contact phone number',
  },
  emergency_contact_relation: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Relation to employee',
  },
  blood_group: {
    type: DataTypes.STRING(10),
    allowNull: true,
  },
  lic_details: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  is_first_login: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  refresh_token: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  reset_password_token: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  reset_password_expires: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'employees',
  indexes: [
    { fields: ['emp_code'] },
    { fields: ['email'] },
    { fields: ['department'] },
    { fields: ['role'] },
    { fields: ['status'] },
    { fields: ['company_id'] },
    { fields: ['office_id'] },
  ],
});

module.exports = Employee;