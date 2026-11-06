require('dotenv').config();
require('../config/env');
const models = require('../models');
const { sequelize } = models;

async function run() {
  try {
    console.log('--- Inspecting Database Schema ---');
    const queryInterface = sequelize.getQueryInterface();

    for (const [modelName, model] of Object.entries(models)) {
      if (!model.tableName) continue;

      let tableDescription;
      try {
        tableDescription = await queryInterface.describeTable(model.tableName);
      } catch (err) {
        console.log(`Table ${model.tableName} does not exist yet (will be created on sync).`);
        continue;
      }

      const existingColumns = Object.keys(tableDescription);
      const attributes = model.rawAttributes;

      for (const [attrName, attrDef] of Object.entries(attributes)) {
        const colName = attrDef.field || attrName;
        if (!existingColumns.includes(colName)) {
          console.log(`Adding missing column [${colName}] to table [${model.tableName}]...`);
          try {
            await queryInterface.addColumn(model.tableName, colName, attrDef);
            console.log(`  Successfully added column ${colName}`);
          } catch (colErr) {
            console.error(`  Failed to add column ${colName}:`, colErr.message);
          }
        }
      }
    }
    console.log('--- Schema Inspection & Migration Completed ---');
  } catch (error) {
    console.error('Fatal error during schema migration:', error);
  } finally {
    await sequelize.close();
  }
}

run();
