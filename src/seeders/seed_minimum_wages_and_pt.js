const { MinimumWage, ProfessionalTaxSlab } = require('../models');
const logger = require('../utils/logger');

const minimumWagesData = [
  // Madhya Pradesh
  { state: 'MP', wages_category: 'Unskilled', monthly_wage: 12575, remark: 'From October 2026', effective_from: '2026-10-01' },
  { state: 'MP', wages_category: 'Semi-skilled', monthly_wage: 13571, remark: 'From October 2026', effective_from: '2026-10-01' },
  { state: 'MP', wages_category: 'Skilled', monthly_wage: 15294, remark: 'From October 2026', effective_from: '2026-10-01' },
  { state: 'MP', wages_category: 'Highly Skilled', monthly_wage: 16919, remark: 'From October 2026', effective_from: '2026-10-01' },

  // Lucknow (Uttar Pradesh)
  { state: 'Lucknow', wages_category: 'Unskilled', monthly_wage: 13006, remark: 'From Apr 2026', effective_from: '2026-04-01' },
  { state: 'Lucknow', wages_category: 'Semi-skilled', monthly_wage: 14306, remark: 'From Apr 2026', effective_from: '2026-04-01' },
  { state: 'Lucknow', wages_category: 'Skilled', monthly_wage: 16025, remark: 'From Apr 2026', effective_from: '2026-04-01' },

  // Rajasthan
  { state: 'Rajsthan', wages_category: 'Unskilled', monthly_wage: 7722, remark: 'From Apr 2026', effective_from: '2026-04-01' },
  { state: 'Rajsthan', wages_category: 'Semi-skilled', monthly_wage: 8034, remark: 'From Apr 2026', effective_from: '2026-04-01' },
  { state: 'Rajsthan', wages_category: 'Skilled', monthly_wage: 8346, remark: 'From Apr 2026', effective_from: '2026-04-01' },
  { state: 'Rajsthan', wages_category: 'Highly Skilled', monthly_wage: 9646, remark: 'From Apr 2026', effective_from: '2026-04-01' },

  // Nagpur (Maharashtra)
  { state: 'Nagpur', wages_category: 'Unskilled', monthly_wage: 14155, remark: 'From Jul 2026', effective_from: '2026-07-01' },
  { state: 'Nagpur', wages_category: 'Semi-skilled', monthly_wage: 14990, remark: 'From Jul 2026', effective_from: '2026-07-01' },
  { state: 'Nagpur', wages_category: 'Skilled', monthly_wage: 15766, remark: 'From Jul 2026', effective_from: '2026-07-01' },
];

const ptSlabsData = [
  // Madhya Pradesh
  { state: 'Madhya Pradesh', state_short: 'MP', is_applicable: true, gender: 'All', salary_from: 0, salary_to: 18750, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Madhya Pradesh', state_short: 'MP', is_applicable: true, gender: 'All', salary_from: 18751, salary_to: 25000, monthly_tax: 125, yearly_tax: 1500 },
  { state: 'Madhya Pradesh', state_short: 'MP', is_applicable: true, gender: 'All', salary_from: 25001, salary_to: 33333, monthly_tax: 166.67, yearly_tax: 2000 },
  { state: 'Madhya Pradesh', state_short: 'MP', is_applicable: true, gender: 'All', salary_from: 33334, salary_to: null, monthly_tax: 208.33, yearly_tax: 2500 },

  // Maharashtra
  { state: 'Maharashtra', state_short: 'MH', is_applicable: true, gender: 'Male', salary_from: 0, salary_to: 7500, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Maharashtra', state_short: 'MH', is_applicable: true, gender: 'Male', salary_from: 7501, salary_to: 10000, monthly_tax: 175, yearly_tax: 2100 },
  { state: 'Maharashtra', state_short: 'MH', is_applicable: true, gender: 'Male', salary_from: 10001, salary_to: null, monthly_tax: 208.33, yearly_tax: 2500 },
  { state: 'Maharashtra', state_short: 'MH', is_applicable: true, gender: 'Female', salary_from: 0, salary_to: 25000, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Maharashtra', state_short: 'MH', is_applicable: true, gender: 'Female', salary_from: 25001, salary_to: null, monthly_tax: 208.33, yearly_tax: 2500 },

  // Other Common States (Delhi, UP, Rajasthan, Haryana - No PT)
  { state: 'Delhi', state_short: 'DL', is_applicable: false, gender: 'All', salary_from: 0, salary_to: null, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Uttar Pradesh', state_short: 'UP', is_applicable: false, gender: 'All', salary_from: 0, salary_to: null, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Rajasthan', state_short: 'RJ', is_applicable: false, gender: 'All', salary_from: 0, salary_to: null, monthly_tax: 0, yearly_tax: 0 },
  { state: 'Haryana', state_short: 'HR', is_applicable: false, gender: 'All', salary_from: 0, salary_to: null, monthly_tax: 0, yearly_tax: 0 },
];

async function seedMinimumWagesAndPt() {
  try {
    for (const mw of minimumWagesData) {
      await MinimumWage.findOrCreate({
        where: { state: mw.state, wages_category: mw.wages_category },
        defaults: mw,
      });
    }
    logger.info(`✅ Seeded / Verified ${minimumWagesData.length} Minimum Wage rates`);

    for (const pt of ptSlabsData) {
      await ProfessionalTaxSlab.findOrCreate({
        where: {
          state: pt.state,
          gender: pt.gender,
          salary_from: pt.salary_from,
        },
        defaults: pt,
      });
    }
    logger.info(`✅ Seeded / Verified ${ptSlabsData.length} Professional Tax slab records`);
  } catch (err) {
    logger.error('Error seeding Minimum Wages & PT:', err);
  }
}

module.exports = { seedMinimumWagesAndPt, minimumWagesData, ptSlabsData };
