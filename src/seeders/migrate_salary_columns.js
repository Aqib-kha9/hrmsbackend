require('dotenv').config();
const { sequelize } = require('../models');

async function migrateColumns() {
  try {
    const qi = sequelize.getQueryInterface();
    const tableDesc = await qi.describeTable('salary_structures');
    const cols = Object.keys(tableDesc);
    console.log('Existing columns in salary_structures:', cols.length);

    const additions = [
      { name: 'calculation_basis', sql: "ALTER TABLE salary_structures ADD COLUMN calculation_basis ENUM('CTC', 'Gross', 'Net Take Home') DEFAULT 'CTC'" },
      { name: 'state', sql: "ALTER TABLE salary_structures ADD COLUMN state VARCHAR(100) NULL" },
      { name: 'wages_category', sql: "ALTER TABLE salary_structures ADD COLUMN wages_category VARCHAR(50) NULL" },
      { name: 'minimum_wage', sql: "ALTER TABLE salary_structures ADD COLUMN minimum_wage DECIMAL(12, 2) DEFAULT 0" },
      { name: 'basic_pct', sql: "ALTER TABLE salary_structures ADD COLUMN basic_pct DECIMAL(5, 4) DEFAULT 0.50" },
      { name: 'hra_pct', sql: "ALTER TABLE salary_structures ADD COLUMN hra_pct DECIMAL(5, 4) DEFAULT 0.40" },
      { name: 'pf_wage_limit', sql: "ALTER TABLE salary_structures ADD COLUMN pf_wage_limit DECIMAL(12, 2) DEFAULT 25000" },
      { name: 'esic_calc_base', sql: "ALTER TABLE salary_structures ADD COLUMN esic_calc_base ENUM('Basic', 'Gross') DEFAULT 'Basic'" },
      { name: 'esic_wage_limit', sql: "ALTER TABLE salary_structures ADD COLUMN esic_wage_limit DECIMAL(12, 2) DEFAULT 21000" },
      { name: 'gratuity_applicable', sql: "ALTER TABLE salary_structures ADD COLUMN gratuity_applicable TINYINT(1) DEFAULT 1" },
      { name: 'gratuity_pct', sql: "ALTER TABLE salary_structures ADD COLUMN gratuity_pct DECIMAL(5, 4) DEFAULT 0.0481" },
      { name: 'gratuity_amount', sql: "ALTER TABLE salary_structures ADD COLUMN gratuity_amount DECIMAL(12, 2) DEFAULT 0" },
      { name: 'bonus_applicable', sql: "ALTER TABLE salary_structures ADD COLUMN bonus_applicable TINYINT(1) DEFAULT 0" },
      { name: 'bonus_pct', sql: "ALTER TABLE salary_structures ADD COLUMN bonus_pct DECIMAL(5, 4) DEFAULT 0.0833" },
      { name: 'statutory_bonus', sql: "ALTER TABLE salary_structures ADD COLUMN statutory_bonus DECIMAL(12, 2) DEFAULT 0" },
      { name: 'exgratia_bonus', sql: "ALTER TABLE salary_structures ADD COLUMN exgratia_bonus DECIMAL(12, 2) DEFAULT 0" },
      { name: 'pt_amount', sql: "ALTER TABLE salary_structures ADD COLUMN pt_amount DECIMAL(12, 2) DEFAULT 0" },
      { name: 'tds_monthly', sql: "ALTER TABLE salary_structures ADD COLUMN tds_monthly DECIMAL(12, 2) DEFAULT 0" },
      { name: 'lwf_monthly', sql: "ALTER TABLE salary_structures ADD COLUMN lwf_monthly DECIMAL(12, 2) DEFAULT 0" },
      { name: 'loan_emi_monthly', sql: "ALTER TABLE salary_structures ADD COLUMN loan_emi_monthly DECIMAL(12, 2) DEFAULT 0" },
      { name: 'other_deductions_monthly', sql: "ALTER TABLE salary_structures ADD COLUMN other_deductions_monthly DECIMAL(12, 2) DEFAULT 0" },
      { name: 'net_take_home', sql: "ALTER TABLE salary_structures ADD COLUMN net_take_home DECIMAL(12, 2) DEFAULT 0" },
      { name: 'current_take_home', sql: "ALTER TABLE salary_structures ADD COLUMN current_take_home DECIMAL(12, 2) DEFAULT 0" }
    ];

    for (const add of additions) {
      if (!cols.includes(add.name)) {
        console.log('Adding column:', add.name);
        try {
          await sequelize.query(add.sql);
          console.log('Successfully added:', add.name);
        } catch (e) {
          console.error('Failed to add ' + add.name + ':', e.message);
        }
      }
    }

    console.log('✅ All missing columns added successfully to salary_structures!');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

migrateColumns();
