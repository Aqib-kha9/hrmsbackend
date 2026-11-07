const { sequelize } = require('../config/database');

// Import all models
const Employee = require('./employee.model');
const Office = require('./office.model');
const Company = require('./company.model');
const AttendanceRecord = require('./attendance_record.model');
const MonthlyAttendance = require('./monthly_attendance.model');
const LeaveBalance = require('./leave_balance.model');
const LeaveRequest = require('./leave_request.model');
const Payslip = require('./payslip.model');
const SalaryComponent = require('./salary_component.model');
const Loan = require('./loan.model');
const LoanPayment = require('./loan_payment.model');
const PerformanceObjective = require('./performance_objective.model');
const PerformanceReview = require('./performance_review.model');
const Document = require('./document.model');
const Letter = require('./letter.model');
const LetterTemplate = require('./letter_template.model');
const Notification = require('./notification.model');
const PayrollCycle = require('./payroll_cycle.model');
const PayrollEntry = require('./payroll_entry.model');
const SalaryStructure = require('./salary_structure.model');
const SalaryRevision = require('./salary_revision.model');
const TourExpense = require('./tour_expense.model');
const TourExpensePolicy = require('./tour_expense_policy.model');
const Tour = require('./tour.model');
const Holiday = require('./holiday.model');
const SystemSetting = require('./system_setting.model');
const AuthorisedSignatory = require('./authorised_signatory.model');
const Role = require('./role.model');
const Permission = require('./permission.model');
const RolePermission = require('./role_permission.model');

// ── Define Associations ──

// RBAC Associations
Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'role_id', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permission_id', as: 'roles' });
Role.hasMany(RolePermission, { foreignKey: 'role_id', as: 'rolePermissions' });
RolePermission.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });
Permission.hasMany(RolePermission, { foreignKey: 'permission_id', as: 'permissionRoles' });
RolePermission.belongsTo(Permission, { foreignKey: 'permission_id', as: 'permission' });

Employee.belongsTo(Role, { foreignKey: 'role_id', as: 'roleDetails' });
Role.hasMany(Employee, { foreignKey: 'role_id', as: 'employees' });

// Employee → Office (works at)
Employee.belongsTo(Office, { foreignKey: 'office_id', as: 'office' });
Office.hasMany(Employee, { foreignKey: 'office_id', as: 'employees' });

// Company → Office (multi-company → multi-location hierarchy)
Company.hasMany(Office, { foreignKey: 'company_id', as: 'offices' });
Office.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company → Employee (multi-company hierarchy)
Company.hasMany(Employee, { foreignKey: 'company_id', as: 'employees' });
Employee.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });
// Employee → AttendanceRecord
Employee.hasMany(AttendanceRecord, { foreignKey: 'employee_id', as: 'attendanceRecords' });
AttendanceRecord.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });
AttendanceRecord.belongsTo(Office, { foreignKey: 'punch_in_office_id', as: 'punchInOffice' });
AttendanceRecord.belongsTo(Office, { foreignKey: 'punch_out_office_id', as: 'punchOutOffice' });
AttendanceRecord.belongsTo(Employee, { foreignKey: 'marked_by_id', as: 'markedBy' });
Office.hasMany(AttendanceRecord, { foreignKey: 'punch_in_office_id', as: 'punchInRecords' });
Office.hasMany(AttendanceRecord, { foreignKey: 'punch_out_office_id', as: 'punchOutRecords' });

// Employee → MonthlyAttendance
Employee.hasMany(MonthlyAttendance, { foreignKey: 'employee_id', as: 'monthlyAttendances' });
MonthlyAttendance.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → LeaveBalance
Employee.hasOne(LeaveBalance, { foreignKey: 'employee_id', as: 'leaveBalance' });
LeaveBalance.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → LeaveRequest
Employee.hasMany(LeaveRequest, { foreignKey: 'employee_id', as: 'leaveRequests' });
LeaveRequest.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });
// LeaveRequest → Employee (approver)
LeaveRequest.belongsTo(Employee, { foreignKey: 'approved_by', as: 'approver' });
Employee.hasMany(LeaveRequest, { foreignKey: 'approved_by', as: 'approvedLeaves' });

// Employee → Payslip
Employee.hasMany(Payslip, { foreignKey: 'employee_id', as: 'payslips' });
Payslip.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Payslip → SalaryComponent
Payslip.hasMany(SalaryComponent, { foreignKey: 'payslip_id', as: 'components' });
SalaryComponent.belongsTo(Payslip, { foreignKey: 'payslip_id', as: 'payslip' });

// Employee → Loan
Employee.hasMany(Loan, { foreignKey: 'employee_id', as: 'loans' });
Loan.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });
// Loan → Employee (approver)
Loan.belongsTo(Employee, { foreignKey: 'approved_by', as: 'approver' });
Employee.hasMany(Loan, { foreignKey: 'approved_by', as: 'approvedLoans' });

// Loan → LoanPayment
Loan.hasMany(LoanPayment, { foreignKey: 'loan_id', as: 'payments' });
LoanPayment.belongsTo(Loan, { foreignKey: 'loan_id', as: 'loan' });

// PayrollCycle → PayrollEntry
PayrollCycle.hasMany(PayrollEntry, { foreignKey: 'cycle_id', as: 'entries' });
PayrollEntry.belongsTo(PayrollCycle, { foreignKey: 'cycle_id', as: 'cycle' });

// Employee → PayrollEntry
Employee.hasMany(PayrollEntry, { foreignKey: 'employee_id', as: 'payrollEntries' });
PayrollEntry.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → PerformanceObjective
Employee.hasMany(PerformanceObjective, { foreignKey: 'employee_id', as: 'objectives' });
PerformanceObjective.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → PerformanceReview (employee being reviewed)
Employee.hasOne(PerformanceReview, { foreignKey: 'employee_id', as: 'performanceReview' });
PerformanceReview.belongsTo(Employee, { foreignKey: 'employee_id', as: 'reviewedEmployee' });
// PerformanceReview → Employee (reviewer)
PerformanceReview.belongsTo(Employee, { foreignKey: 'reviewed_by', as: 'reviewer' });
Employee.hasMany(PerformanceReview, { foreignKey: 'reviewed_by', as: 'reviewsGiven' });

// Employee → Document
Employee.hasMany(Document, { foreignKey: 'employee_id', as: 'documents' });
Document.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → Letter (employee receiving the letter)
Employee.hasMany(Letter, { foreignKey: 'employee_id', as: 'letters', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Letter.belongsTo(Employee, { foreignKey: 'employee_id', as: 'issuedTo', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
// Letter → Employee (issuer)
Letter.belongsTo(Employee, { foreignKey: 'issued_by', as: 'issuedBy' });
Employee.hasMany(Letter, { foreignKey: 'issued_by', as: 'lettersIssued' });

// Employee → Notification
Employee.hasMany(Notification, { foreignKey: 'employee_id', as: 'notifications' });
Notification.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → SalaryStructure
Employee.hasMany(SalaryStructure, { foreignKey: 'employee_id', as: 'salaryStructures' });
SalaryStructure.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee → SalaryRevision
Employee.hasMany(SalaryRevision, { foreignKey: 'employee_id', as: 'salaryRevisions' });
SalaryRevision.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });
// SalaryRevision → Employee (approver)
SalaryRevision.belongsTo(Employee, { foreignKey: 'approved_by', as: 'approver' });
Employee.hasMany(SalaryRevision, { foreignKey: 'approved_by', as: 'approvedRevisions' });

// Employee → TourExpense
Employee.hasMany(TourExpense, { foreignKey: 'employee_id', as: 'tourExpenses' });
TourExpense.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });
// TourExpense → Employee (approver)
TourExpense.belongsTo(Employee, { foreignKey: 'approved_by', as: 'approver' });
Employee.hasMany(TourExpense, { foreignKey: 'approved_by', as: 'approvedTourExpenses' });

// Employee → Tour (employee on tour)
Employee.hasMany(Tour, { foreignKey: { name: 'employee_id', allowNull: false }, as: 'tours', onDelete: 'CASCADE' });
Tour.belongsTo(Employee, { foreignKey: { name: 'employee_id', allowNull: false }, as: 'employee', onDelete: 'CASCADE' });
// Tour → Employee (creator / admin who assigned the tour)
Tour.belongsTo(Employee, { foreignKey: { name: 'created_by', allowNull: true }, as: 'creator', onDelete: 'SET NULL' });
Employee.hasMany(Tour, { foreignKey: { name: 'created_by', allowNull: true }, as: 'createdTours', onDelete: 'SET NULL' });
// Tour → Employee (canceller)
Tour.belongsTo(Employee, { foreignKey: { name: 'cancelled_by', allowNull: true }, as: 'canceller', onDelete: 'SET NULL' });
Employee.hasMany(Tour, { foreignKey: { name: 'cancelled_by', allowNull: true }, as: 'cancelledTours', onDelete: 'SET NULL' });

// OnboardingInvitation associations
const OnboardingInvitation = require('./onboarding_invitation.model');
OnboardingInvitation.belongsTo(Office, { foreignKey: 'office_id', as: 'office' });
OnboardingInvitation.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });
OnboardingInvitation.belongsTo(Employee, { foreignKey: 'created_by', as: 'creator' });
OnboardingInvitation.belongsTo(Employee, { foreignKey: 'approved_by', as: 'approver' });

// Letter → AuthorisedSignatory
Letter.belongsTo(AuthorisedSignatory, { foreignKey: 'signatory_id', as: 'signatory' });

module.exports = {
  sequelize,
  Employee,
  Office,
  Company,
  AttendanceRecord,
  MonthlyAttendance,
  LeaveBalance,
  LeaveRequest,
  Payslip,
  SalaryComponent,
  Loan,
  LoanPayment,
  PayrollCycle,
  PayrollEntry,
  PerformanceObjective,
  PerformanceReview,
  Document,
  Letter,
  LetterTemplate,
  Notification,
  SalaryStructure,
  SalaryRevision,
  TourExpense,
  TourExpensePolicy,
  Tour,
  Holiday,
  SystemSetting,
  AuthorisedSignatory,
  OnboardingInvitation,
  Role,
  Permission,
  RolePermission,
};