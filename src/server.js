require('dotenv').config();
if (process.env.NODE_ENV) {
  process.env.NODE_ENV = process.env.NODE_ENV.trim();
}
const app = require('./app');
const logger = require('./utils/logger');
const models = require('./models');
const { sequelize } = models;

const PORT = process.env.PORT || 5000;

/**
 * Start server after database connection is verified
 */
async function startServer() {
  try {
    // Verify database connection
    await sequelize.authenticate();
    logger.info('✅ MySQL database connected successfully');
    // Clean up duplicate indexes (MySQL max 64 keys error fix)
    try {
      const [indexResults] = await sequelize.query(`
        SELECT table_name, index_name 
        FROM information_schema.statistics 
        WHERE table_schema = DATABASE() AND index_name != 'PRIMARY'
      `);
      
      const indexCounts = {};
      indexResults.forEach(r => {
        const tName = r.table_name || r.TABLE_NAME;
        const iName = r.index_name || r.INDEX_NAME;
        if (!tName || !iName) return;
        indexCounts[tName] = (indexCounts[tName] || 0) + 1;
      });
      
      for (const [tableName, count] of Object.entries(indexCounts)) {
        if (count > 20) {
          logger.info(`🧹 Cleaning up ${count} duplicate indexes on table ${tableName}...`);
          const tableIndexes = indexResults.filter(r => (r.table_name || r.TABLE_NAME) === tableName);
          for (const row of tableIndexes) {
            const idxName = row.index_name || row.INDEX_NAME;
            try {
              await sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idxName}\``);
            } catch (e) {
              // Ignore drop errors (e.g., if index is required by a foreign key)
            }
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to run index cleanup:', e.message);
    }

    // Auto-verify and add any missing table columns from models before index sync
    try {
      const queryInterface = sequelize.getQueryInterface();
      for (const [modelName, model] of Object.entries(models)) {
        if (!model.tableName) continue;
        let tableDescription;
        try {
          tableDescription = await queryInterface.describeTable(model.tableName);
        } catch (err) {
          continue; // Table will be created by sequelize.sync
        }
        const existingColumns = Object.keys(tableDescription);
        const attributes = model.rawAttributes;
        for (const [attrName, attrDef] of Object.entries(attributes)) {
          const colName = attrDef.field || attrName;
          if (!existingColumns.includes(colName)) {
            try {
              await queryInterface.addColumn(model.tableName, colName, attrDef);
              logger.info(`Auto-added missing column [${colName}] to [${model.tableName}]`);
            } catch (colErr) {
              // Ignore if already added or race condition
            }
          }
        }
      }
    } catch (colCheckErr) {
      logger.warn('Column auto-migration check warning:', colCheckErr.message);
    }

    // Auto-fix schema constraints & nullability (e.g. employee_id on letters, created_by/cancelled_by on tours)
    try {
      const [colInfo] = await sequelize.query(`
        SELECT is_nullable 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'letters' AND column_name = 'employee_id'
      `);
      const isNullable = colInfo.length > 0 && (colInfo[0].is_nullable || colInfo[0].IS_NULLABLE);
      if (colInfo.length > 0 && isNullable !== 'YES') {
        await sequelize.query('ALTER TABLE `letters` MODIFY COLUMN `employee_id` INT NULL;');
      }
    } catch (e) {
      // Table will be created by sequelize.sync if it does not exist
    }

    try {
      await sequelize.query('ALTER TABLE `tours` MODIFY COLUMN `created_by` INT NULL;');
    } catch (e) {
      // Table or column may not exist yet
    }

    try {
      await sequelize.query('ALTER TABLE `tours` MODIFY COLUMN `cancelled_by` INT NULL;');
    } catch (e) {
      // Table or column may not exist yet
    }

    // Sync models (alter: true adds missing columns without data loss)
    const forceSync = process.env.DB_SYNC_FORCE === 'true';
    const alterSync = process.env.DB_SYNC_ALTER === 'true';
    try {
      await sequelize.sync({ force: forceSync, alter: alterSync });
      logger.info(`✅ Database models synced (force: ${forceSync}, alter: ${alterSync})`);
    } catch (syncErr) {
      logger.warn(`⚠️ sequelize.sync with alter=${alterSync} failed: ${syncErr.message}. Falling back to safe sync()...`);
      await sequelize.sync();
      logger.info('✅ Database models synced with safe sync() fallback');
    }

    // Ensure RBAC system roles and permissions exist
    try {
      const roleCount = await models.Role.count();
      if (roleCount === 0) {
        const { seedRBAC } = require('./seeders/seed_rbac');
        await seedRBAC();
      }

      // Auto-sync legacy employees missing role_id to corresponding System Role
      const nullRoleEmployees = await models.Employee.findAll({ where: { role_id: null } });
      if (nullRoleEmployees.length > 0) {
        const roles = await models.Role.findAll();
        const roleMap = new Map(roles.map((r) => [r.name.toUpperCase(), r]));
        for (const emp of nullRoleEmployees) {
          const lower = (emp.role || 'employee').toLowerCase();
          let targetRole = roleMap.get('EMPLOYEE');
          if (lower.includes('admin') || lower === 'super_admin') {
            targetRole = roleMap.get('SUPER_ADMIN') || roleMap.get('ADMIN');
          } else if (lower === 'hr') {
            targetRole = roleMap.get('HR');
          } else if (lower === 'manager') {
            targetRole = roleMap.get('MANAGER');
          }
          if (targetRole) {
            await emp.update({ role_id: targetRole.id });
          }
        }
        logger.info(`✅ Auto-synced role_id for ${nullRoleEmployees.length} legacy employees`);
      }
    } catch (rbacErr) {
      logger.warn('RBAC auto-seed check:', rbacErr.message);
    }

    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 HRMS Backend running on port ${PORT}`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   API Prefix: ${process.env.API_PREFIX || '/api/v1'}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`\n${signal} received — shutting down gracefully...`);
      server.close(() => logger.info('HTTP server closed'));
      await sequelize.close();
      logger.info('Database connection closed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();


