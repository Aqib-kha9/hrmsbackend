const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { Employee, sequelize } = require('../models');

async function seedDevAccounts() {
  try {
    console.log('Seeding dev accounts into database...\n');
    const passwordHash = await bcrypt.hash('Password@123', 12);

    const devAccounts = [
      {
        emp_code: 'ADM002',
        name: 'System Admin',
        email: 'admin@hrms.com',
        phone: '9800000002',
        password: passwordHash,
        designation: 'Operations Administrator',
        department: 'Administration',
        role_id: 2,
        role: 'admin',
        status: 'active',
        company_id: 1,
        office_id: 1,
        date_of_joining: '2024-01-01',
        is_first_login: false,
      },
      {
        emp_code: 'HR001',
        name: 'Priya Sharma (HR)',
        email: 'hr@hrms.com',
        phone: '9800000003',
        password: passwordHash,
        designation: 'HR Manager',
        department: 'Human Resources',
        role_id: 3,
        role: 'hr',
        status: 'active',
        company_id: 1,
        office_id: 1,
        date_of_joining: '2024-01-01',
        is_first_login: false,
      },
      {
        emp_code: 'MGR001',
        name: 'Amit Patel (Manager)',
        email: 'manager@hrms.com',
        phone: '9800000004',
        password: passwordHash,
        designation: 'Operations Manager',
        department: 'Operations',
        role_id: 4,
        role: 'manager',
        status: 'active',
        company_id: 1,
        office_id: 1,
        date_of_joining: '2024-01-01',
        is_first_login: false,
      },
      {
        emp_code: 'EMP101',
        name: 'Rahul Verma (Staff)',
        email: 'employee@hrms.com',
        phone: '9800000005',
        password: passwordHash,
        designation: 'Senior Associate',
        department: 'Operations',
        role_id: 5,
        role: 'employee',
        status: 'active',
        company_id: 1,
        office_id: 1,
        date_of_joining: '2024-01-01',
        is_first_login: false,
      },
    ];

    for (const acc of devAccounts) {
      const [emp, created] = await Employee.findOrCreate({
        where: { email: acc.email },
        defaults: acc,
      });

      if (!created) {
        await emp.update({
          password: passwordHash,
          role_id: acc.role_id,
          role: acc.role,
          status: 'active',
        });
        console.log(`Updated existing user: ${acc.email} (${acc.role})`);
      } else {
        console.log(`Created new dev account: ${acc.email} (${acc.role})`);
      }
    }

    console.log('\nAll dev accounts seeded successfully with password: Password@123');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding dev accounts:', err.message);
    process.exit(1);
  }
}

seedDevAccounts();

