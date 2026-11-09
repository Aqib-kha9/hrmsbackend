const { Company, Office } = require('../models');
const { PAGINATION } = require('../utils/constants');
const logger = require('../utils/logger');

function deriveCompanyPrefix(name) {
  if (!name) return 'APA';
  const clean = name.trim();
  if (/^apaar/i.test(clean)) return 'APA';
  if (/^bp\s*marketing/i.test(clean)) return 'BPM';
  if (/^ae\b/i.test(clean)) return 'AE';
  if (/^pj\b/i.test(clean)) return 'PJ';

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const acronym = words.map(w => w[0].toUpperCase()).join('').slice(0, 4);
    if (acronym.length >= 2) return acronym;
  }
  return clean.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'APA';
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