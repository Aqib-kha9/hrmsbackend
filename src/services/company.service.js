const { Company, Office } = require('../models');
const { PAGINATION } = require('../utils/constants');
const logger = require('../utils/logger');

function deriveCompanyPrefix(name) {
  if (!name) return 'EMP';
  const clean = name.trim();

  // Specific client requirements for company prefixes:
  // AS - AE Solutions
  // AL - Apaar Logistics
  // BM - BP Marketing
  // PE - PJ Enterprises
  if (/^ae\s*solutions/i.test(clean) || /^ae\b/i.test(clean)) return 'AS';
  if (/^apaar\s*logistics/i.test(clean) || /^apaar/i.test(clean)) return 'AL';
  if (/^bp\s*marketing/i.test(clean) || /^bp\b/i.test(clean)) return 'BM';
  if (/^pj\s*enterprises/i.test(clean) || /^pj\b/i.test(clean)) return 'PE';

  // Future companies added by admin:
  // Filter out common corporate stop words to form clean acronyms
  const stopWords = new Set([
    'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'corp', 'corporation',
    'company', 'co', 'and', '&', 'the'
  ]);

  let words = clean
    .split(/[\s\-_]+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));

  if (words.length === 0) {
    words = clean
      .split(/[\s\-_]+/)
      .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(w => w.length > 0);
  }

  if (words.length >= 2) {
    const acronym = words.map(w => w[0].toUpperCase()).join('').slice(0, 4);
    if (acronym.length >= 2) return acronym;
  }

  if (words.length === 1) {
    const single = words[0].toUpperCase();
    return single.length >= 2 ? single.slice(0, Math.min(3, single.length)) : single.padEnd(2, 'X');
  }

  return clean.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'EMP';
}

class CompanyService {
  /**
   * Get all active companies with employee ID prefix metadata.
   * @param {Object} [options]
   * @param {boolean} [options.activeOnly=true] - Only return active companies
   * @returns {Promise<Array>}
   */
  async getCompanies({ activeOnly = true } = {}) {
    const where = activeOnly ? { is_active: true } : {};
    const companies = await Company.findAll({
      where,
      order: [['name', 'ASC']],
    });
    return companies.map(c => {
      const data = c.toJSON ? c.toJSON() : { ...c };
      if (!data.code) {
        data.code = deriveCompanyPrefix(data.name);
      }
      return data;
    });
  }

  /**
   * Get a single company by ID.
   */
  async getCompanyById(id) {
    const company = await Company.findByPk(id);
    if (!company) {
      const err = new Error('Company not found');
      err.statusCode = 404;
      throw err;
    }
    if (!company.code) {
      company.code = deriveCompanyPrefix(company.name);
    }
    return company;
  }

  /**
   * Create a new company entity with company prefix.
   */
  async createCompany({ name, code, email, phone, website, city, state, address }) {
    const existing = await Company.findOne({ where: { name } });
    if (existing) {
      const err = new Error('A company with this name already exists');
      err.statusCode = 409;
      throw err;
    }
    const finalCode = (code && code.trim()) ? code.trim().toUpperCase() : deriveCompanyPrefix(name);
    const company = await Company.create({ name, code: finalCode, email, phone, website, city, state, address });
    logger.info(`Company created: ${company.name} (id: ${company.id}, code: ${company.code})`);
    return company;
  }

  /**
   * Update a company.
   */
  async updateCompany(id, { name, code, email, phone, website, city, state, address, is_active }) {
    const company = await this.getCompanyById(id);
    if (name !== undefined) company.name = name;
    if (code !== undefined) company.code = code ? code.trim().toUpperCase() : deriveCompanyPrefix(company.name);
    if (email !== undefined) company.email = email;
    if (phone !== undefined) company.phone = phone;
    if (website !== undefined) company.website = website;
    if (city !== undefined) company.city = city;
    if (state !== undefined) company.state = state;
    if (address !== undefined) company.address = address;
    if (is_active !== undefined) company.is_active = is_active;
    await company.save();
    logger.info(`Company updated: ${company.name} (id: ${company.id}, code: ${company.code})`);
    return company;
  }

  /**
   * Soft-delete (deactivate) a company.
   */
  async deleteCompany(id) {
    const company = await this.getCompanyById(id);
    await company.destroy();
    logger.info(`Company deleted: ${company.name} (id: ${company.id})`);
    return true;
  }
}

module.exports = new CompanyService();