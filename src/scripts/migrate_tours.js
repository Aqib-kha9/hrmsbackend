const { sequelize } = require('../config/database');

async function migrate() {
  console.log('Modifying tours table schema...');

  // Modify status enum
  await sequelize.query(`
    ALTER TABLE tours 
    MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'active', 'completed', 'cancelled') NOT NULL DEFAULT 'pending';
  `);
  console.log('Status column modified successfully.');

  // Add missing columns if they do not exist
  const [cols] = await sequelize.query('DESCRIBE tours;');
  const colNames = cols.map(c => c.Field);

  if (!colNames.includes('approved_by')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN approved_by INT NULL REFERENCES employees(id);');
    console.log('Added approved_by');
  }
  if (!colNames.includes('approved_at')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN approved_at DATETIME NULL;');
    console.log('Added approved_at');
  }
  if (!colNames.includes('rejected_by')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN rejected_by INT NULL REFERENCES employees(id);');
    console.log('Added rejected_by');
  }
  if (!colNames.includes('rejected_at')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN rejected_at DATETIME NULL;');
    console.log('Added rejected_at');
  }
  if (!colNames.includes('rejection_reason')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN rejection_reason TEXT NULL;');
    console.log('Added rejection_reason');
  }
  if (!colNames.includes('advance_amount')) {
    await sequelize.query('ALTER TABLE tours ADD COLUMN advance_amount DECIMAL(10,2) NOT NULL DEFAULT 0;');
    console.log('Added advance_amount');
  }

  const [newCols] = await sequelize.query('DESCRIBE tours;');
  console.log('Updated tours columns:', newCols.map(c => ({ Field: c.Field, Type: c.Type })));
}

migrate()
  .then(() => {
    console.log('Migration completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
