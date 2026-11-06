require('dotenv').config();
/**
 * Production RBAC Seeder
 * Sets up enterprise-grade Roles, Permissions, and Role-Permission mappings.
 */
const { Role, Permission, RolePermission, Employee, sequelize } = require('../models');
const logger = require('../utils/logger');

const ALL_MODULES = [
  'DASHBOARD',
  'EMPLOYEES',
  'ONBOARDING',
  'ATTENDANCE',
  'LOCATIONS',
  'LEAVE',
  'PAYROLL',
  'LOANS',
  'PERFORMANCE',
  'LETTERS',
  'TOUR_EXPENSES',
  'REPORTS',
  'SETTINGS',
  'ROLE_MGMT',
];

// Standard CRUD + Enterprise Actions
const MODULE_PERMISSIONS = {
  DASHBOARD: [
    { action: 'READ', slug: 'dashboard:read', desc: 'View executive dashboard metrics and summaries' },
  ],
  EMPLOYEES: [
    { action: 'CREATE', slug: 'employees:create', desc: 'Onboard and add new employees' },
    { action: 'READ', slug: 'employees:read', desc: 'View employee profiles and directories' },
    { action: 'UPDATE', slug: 'employees:update', desc: 'Edit employee details, salary, and status' },
    { action: 'DELETE', slug: 'employees:delete', desc: 'Terminate or delete employee records' },
    { action: 'EXPORT', slug: 'employees:export', desc: 'Export employee data to Excel/CSV' },
  ],
  ONBOARDING: [
    { action: 'CREATE', slug: 'onboarding:create', desc: 'Send self-onboarding invitations' },
    { action: 'READ', slug: 'onboarding:read', desc: 'View candidate onboarding submissions' },
    { action: 'UPDATE', slug: 'onboarding:update', desc: 'Approve or reject candidate submissions' },
    { action: 'DELETE', slug: 'onboarding:delete', desc: 'Cancel pending onboarding invitations' },
  ],
  ATTENDANCE: [
    { action: 'CREATE', slug: 'attendance:create', desc: 'Mark punch-in and punch-out records' },
    { action: 'READ', slug: 'attendance:read', desc: 'View daily and monthly attendance logs' },
    { action: 'UPDATE', slug: 'attendance:update', desc: 'Regularise and adjust attendance records' },
    { action: 'DELETE', slug: 'attendance:delete', desc: 'Delete faulty attendance punches' },
    { action: 'APPROVE', slug: 'attendance:approve', desc: 'Approve attendance regularisation requests' },
    { action: 'EXPORT', slug: 'attendance:export', desc: 'Download muster rolls and monthly attendance reports' },
  ],
  LOCATIONS: [
    { action: 'CREATE', slug: 'locations:create', desc: 'Add new geo-fenced office branches' },
    { action: 'READ', slug: 'locations:read', desc: 'View registered office locations' },
    { action: 'UPDATE', slug: 'locations:update', desc: 'Edit geo-fence coordinates and radius' },
    { action: 'DELETE', slug: 'locations:delete', desc: 'Deactivate office branches' },
  ],
  LEAVE: [
    { action: 'CREATE', slug: 'leave:create', desc: 'Apply for leaves on self or employee behalf' },
    { action: 'READ', slug: 'leave:read', desc: 'View leave balances and application records' },
    { action: 'UPDATE', slug: 'leave:update', desc: 'Adjust leave quota and grant administrative leaves' },
    { action: 'DELETE', slug: 'leave:delete', desc: 'Cancel or withdraw leave requests' },
    { action: 'APPROVE', slug: 'leave:approve', desc: 'Approve or reject leave applications' },
  ],
  PAYROLL: [
    { action: 'CREATE', slug: 'payroll:create', desc: 'Run payroll batches and generate draft payslips' },
    { action: 'READ', slug: 'payroll:read', desc: 'View payroll registers, salary revisions, and payslips' },
    { action: 'UPDATE', slug: 'payroll:update', desc: 'Modify salary structures, bonuses, and deductions' },
    { action: 'DELETE', slug: 'payroll:delete', desc: 'Void or cancel unfinalized payroll runs' },
    { action: 'APPROVE', slug: 'payroll:approve', desc: 'Lock and finalize monthly payroll batches' },
    { action: 'EXPORT', slug: 'payroll:export', desc: 'Download bank transfer files, PF/ESIC ECRs, and payslip PDFs' },
  ],
  LOANS: [
    { action: 'CREATE', slug: 'loans:create', desc: 'Apply for staff loans or disburse company advances' },
    { action: 'READ', slug: 'loans:read', desc: 'View loan ledgers, EMI schedules, and balances' },
    { action: 'UPDATE', slug: 'loans:update', desc: 'Restructure EMIs or adjust recovery amounts' },
    { action: 'DELETE', slug: 'loans:delete', desc: 'Close or cancel loan accounts' },
    { action: 'APPROVE', slug: 'loans:approve', desc: 'Approve loan applications for disbursement' },
  ],
  PERFORMANCE: [
    { action: 'CREATE', slug: 'performance:create', desc: 'Set employee appraisal goals and reviews' },
    { action: 'READ', slug: 'performance:read', desc: 'View appraisal scorecards and reviews' },
    { action: 'UPDATE', slug: 'performance:update', desc: 'Submit manager and employee review ratings' },
    { action: 'DELETE', slug: 'performance:delete', desc: 'Delete outdated objective records' },
    { action: 'APPROVE', slug: 'performance:approve', desc: 'Finalize and publish annual performance ratings' },
  ],
  LETTERS: [
    { action: 'CREATE', slug: 'letters:create', desc: 'Generate offer, appointment, and relieving letters' },
    { action: 'READ', slug: 'letters:read', desc: 'View and download issued letter records' },
    { action: 'UPDATE', slug: 'letters:update', desc: 'Edit letter templates and signature blocks' },
    { action: 'DELETE', slug: 'letters:delete', desc: 'Revoke or delete generated letters' },
  ],
  TOUR_EXPENSES: [
    { action: 'CREATE', slug: 'tour_expenses:create', desc: 'Submit travel claims and outstation tours' },
    { action: 'READ', slug: 'tour_expenses:read', desc: 'View tour expense claims and audit receipts' },
    { action: 'UPDATE', slug: 'tour_expenses:update', desc: 'Edit tour budgets and claim details' },
    { action: 'DELETE', slug: 'tour_expenses:delete', desc: 'Delete or cancel unapproved expense claims' },
    { action: 'APPROVE', slug: 'tour_expenses:approve', desc: 'Approve travel bills for reimbursement' },
    { action: 'EXPORT', slug: 'tour_expenses:export', desc: 'Export travel audit logs' },
  ],
  REPORTS: [
    { action: 'READ', slug: 'reports:read', desc: 'View organizational analytics and statutory reports' },
    { action: 'EXPORT', slug: 'reports:export', desc: 'Download comprehensive audit and statutory exports' },
  ],
  SETTINGS: [
    { action: 'CREATE', slug: 'settings:create', desc: 'Create system and statutory configurations' },
    { action: 'READ', slug: 'settings:read', desc: 'View company settings and policies' },
    { action: 'UPDATE', slug: 'settings:update', desc: 'Update shift times, geo-fence rules, and policies' },
    { action: 'DELETE', slug: 'settings:delete', desc: 'Reset system configurations to defaults' },
  ],
  ROLE_MGMT: [
    { action: 'CREATE', slug: 'role_mgmt:create', desc: 'Create custom security roles' },
    { action: 'READ', slug: 'role_mgmt:read', desc: 'View all roles and assigned permission matrices' },
    { action: 'UPDATE', slug: 'role_mgmt:update', desc: 'Update role permissions and assign users' },
    { action: 'DELETE', slug: 'role_mgmt:delete', desc: 'Delete custom roles' },
  ],
};

const SYSTEM_ROLES = [
  {
    name: 'SUPER_ADMIN',
    display_name: 'Super Administrator',
    description: 'Unrestricted enterprise access to all modules, system configurations, and security policies.',
    is_system: true,
  },
  {
    name: 'ADMIN',
    display_name: 'Administrator',
    description: 'Full operational control over employees, attendance, payroll, loans, and settings.',
    is_system: true,
  },
  {
    name: 'HR',
    display_name: 'HR Manager',
    description: 'Manages employee lifecycles, onboarding, attendance verification, leaves, payroll, and letters.',
    is_system: true,
  },
  {
    name: 'MANAGER',
    display_name: 'Team Manager',
    description: 'Supervises department staff, reviews team attendance, approves team leaves, and conducts appraisals.',
    is_system: true,
  },
  {
    name: 'EMPLOYEE',
    display_name: 'Staff Employee',
    description: 'Self-service access: punch attendance, view personal payslips, submit leave & loan requests.',
    is_system: true,
  },
];

async function seedRBAC() {
  try {
    logger.info('🚀 Starting RBAC seeding...');

    // 1. Ensure tables exist
    await Role.sync();
    await Permission.sync();
    await RolePermission.sync();

    // 2. Seed all permissions
    const permissionMap = new Map(); // slug -> permission instance
    for (const [moduleName, permList] of Object.entries(MODULE_PERMISSIONS)) {
      for (const p of permList) {
        const [perm] = await Permission.findOrCreate({
          where: { slug: p.slug },
          defaults: {
            module: moduleName,
            action: p.action,
            description: p.desc,
          },
        });
        permissionMap.set(p.slug, perm);
      }
    }
    logger.info(`✅ Seeded ${permissionMap.size} fine-grained permissions`);

    // 3. Seed all System Roles
    const roleMap = new Map(); // name -> role instance
    for (const roleDef of SYSTEM_ROLES) {
      const [role] = await Role.findOrCreate({
        where: { name: roleDef.name },
        defaults: roleDef,
      });
      roleMap.set(roleDef.name, role);
    }
    logger.info(`✅ Seeded ${roleMap.size} system roles`);

    // 4. Assign Permissions to Roles

    // SUPER_ADMIN: Gets 100% of all permissions
    const superAdminRole = roleMap.get('SUPER_ADMIN');
    const allPermissions = Array.from(permissionMap.values());
    for (const p of allPermissions) {
      await RolePermission.findOrCreate({
        where: { role_id: superAdminRole.id, permission_id: p.id },
      });
    }

    // ADMIN: All permissions except role_mgmt deletion
    const adminRole = roleMap.get('ADMIN');
    for (const p of allPermissions) {
      await RolePermission.findOrCreate({
        where: { role_id: adminRole.id, permission_id: p.id },
      });
    }

    // HR: Employees, Onboarding, Attendance, Locations (read), Leave, Payroll, Loans, Letters, Reports, Settings (read)
    const hrRole = roleMap.get('HR');
    const hrSlugs = [
      'dashboard:read',
      'employees:create', 'employees:read', 'employees:update', 'employees:export',
      'onboarding:create', 'onboarding:read', 'onboarding:update', 'onboarding:delete',
      'attendance:create', 'attendance:read', 'attendance:update', 'attendance:approve', 'attendance:export',
      'locations:read',
      'leave:create', 'leave:read', 'leave:update', 'leave:approve',
      'payroll:create', 'payroll:read', 'payroll:update', 'payroll:approve', 'payroll:export',
      'loans:create', 'loans:read', 'loans:update', 'loans:approve',
      'performance:read', 'performance:update',
      'letters:create', 'letters:read', 'letters:update',
      'tour_expenses:read', 'tour_expenses:approve', 'tour_expenses:export',
      'reports:read', 'reports:export',
      'settings:read',
    ];
    for (const slug of hrSlugs) {
      const perm = permissionMap.get(slug);
      if (perm) {
        await RolePermission.findOrCreate({
          where: { role_id: hrRole.id, permission_id: perm.id },
        });
      }
    }

    // MANAGER: Team attendance, team leaves, team tour expenses, performance appraisal
    const managerRole = roleMap.get('MANAGER');
    const managerSlugs = [
      'dashboard:read',
      'employees:read',
      'attendance:read', 'attendance:approve',
      'leave:read', 'leave:approve',
      'performance:create', 'performance:read', 'performance:update',
      'tour_expenses:read', 'tour_expenses:approve',
      'reports:read',
    ];
    for (const slug of managerSlugs) {
      const perm = permissionMap.get(slug);
      if (perm) {
        await RolePermission.findOrCreate({
          where: { role_id: managerRole.id, permission_id: perm.id },
        });
      }
    }

    // EMPLOYEE: Self service
    const employeeRole = roleMap.get('EMPLOYEE');
    const employeeSlugs = [
      'dashboard:read',
      'attendance:create', 'attendance:read',
      'leave:create', 'leave:read', 'leave:delete',
      'loans:create', 'loans:read',
      'payroll:read',
      'performance:read',
      'letters:read',
      'tour_expenses:create', 'tour_expenses:read',
    ];
    for (const slug of employeeSlugs) {
      const perm = permissionMap.get(slug);
      if (perm) {
        await RolePermission.findOrCreate({
          where: { role_id: employeeRole.id, permission_id: perm.id },
        });
      }
    }
    logger.info('✅ Seeded permissions matrix for all standard roles');

    // 5. Sync Existing Employees with Role IDs
    const employees = await Employee.findAll();
    for (const emp of employees) {
      const lowerRole = (emp.role || 'employee').toLowerCase();
      let targetRole = employeeRole;
      if (lowerRole.includes('admin') || lowerRole === 'super_admin') {
        targetRole = superAdminRole;
      } else if (lowerRole === 'hr') {
        targetRole = hrRole;
      } else if (lowerRole === 'manager') {
        targetRole = managerRole;
      }

      if (emp.role_id !== targetRole.id) {
        await emp.update({ role_id: targetRole.id });
      }
    }
    logger.info(`✅ Synced role_id for ${employees.length} employees`);

    return true;
  } catch (err) {
    logger.error('❌ Failed to seed RBAC:', err);
    throw err;
  }
}

module.exports = { seedRBAC, ALL_MODULES, MODULE_PERMISSIONS, SYSTEM_ROLES };

if (require.main === module) {
  require('dotenv').config();
  sequelize.authenticate()
    .then(() => seedRBAC())
    .then(() => {
      logger.info('🎉 RBAC migration and seed complete!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
