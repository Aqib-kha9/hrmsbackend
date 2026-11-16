const companyService = require('../services/company.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class CompanyController {
  /**
   * GET /api/v1/companies — list all active companies.
   * Query params: activeOnly (boolean, default true)
   */
  async getCompanies(req, res, next) {
    try {
      const activeOnly = req.query.activeOnly !== 'false';
      const companies = await companyService.getCompanies({ activeOnly });
      return success(res, 'Companies fetched', companies);
    } catch (err) {
      logger.error(`Get companies error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * GET /api/v1/companies/:id
   */
  async getCompanyById(req, res, next) {
    try {
      const company = await companyService.getCompanyById(parseInt(req.params.id));
      return success(res, 'Company fetched', company);
    } catch (err) {
      logger.error(`Get company by id error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * POST /api/v1/companies — create a new company.
   */
  async createCompany(req, res, next) {
    try {
      const { name, code, email, phone, website, city, state, address } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Company name is required' });
      }
      const company = await companyService.createCompany({ name: name.trim(), code, email, phone, website, city, state, address });
      return success(res, 'Company created', company, 201);
    } catch (err) {
      logger.error(`Create company error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * PUT /api/v1/companies/:id
   */
  async updateCompany(req, res, next) {
    try {
      const company = await companyService.updateCompany(parseInt(req.params.id), req.body);
      return success(res, 'Company updated', company);
    } catch (err) {
      logger.error(`Update company error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * DELETE /api/v1/companies/:id
   */
  async deleteCompany(req, res, next) {
    try {
      await companyService.deleteCompany(parseInt(req.params.id));
      return success(res, 'Company deleted');
    } catch (err) {
      logger.error(`Delete company error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new CompanyController();