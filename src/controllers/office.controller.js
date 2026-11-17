const officeService = require('../services/office.service');
const { success, paginated, noContent } = require('../utils/response');

class OfficeController {
  /**
   * GET /api/v1/offices
   * List all offices with filters & pagination.
   */
  async getOffices(req, res, next) {
    try {
      const { search, company_id, city, state, is_active, page, limit } = req.query;
      const result = await officeService.getOffices({
        search,
        company_id: company_id ? parseInt(company_id, 10) : undefined,
        city,
        state,
        is_active: is_active !== undefined ? is_active === 'true' : undefined,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      });

      return paginated(res, 'Offices retrieved successfully', result.rows, result.pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/offices/stats
   * Get aggregated stats for all offices.
   */
  async getOfficeStats(req, res, next) {
    try {
      const stats = await officeService.getOfficeStats();
      return success(res, 'Office stats retrieved successfully', stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/offices/generate-code
   * Suggest next company-specific unique location code based on company & city.
   */
  async generateOfficeCode(req, res, next) {
    try {
      const { company_id, city, name } = req.query;
      const code = await officeService.generateOfficeCode({
        company_id: company_id ? parseInt(company_id, 10) : undefined,
        city,
        name,
      });
      return success(res, 'Location code generated successfully', { code });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/offices/:id
   * Get a single office by ID.
   */
  async getOfficeById(req, res, next) {
    try {
      const office = await officeService.getOfficeById(req.params.id);
      return success(res, 'Office retrieved successfully', office);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/offices
   * Create a new office location.
   */
  async createOffice(req, res, next) {
    try {
      const office = await officeService.createOffice(req.body);
      return success(res, 'Office created successfully', office, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/offices/:id
   * Update an existing office.
   */
  async updateOffice(req, res, next) {
    try {
      const office = await officeService.updateOffice(req.params.id, req.body);
      return success(res, 'Office updated successfully', office);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/offices/:id
   * Soft-delete an office (only if no employees assigned).
   */
  async deleteOffice(req, res, next) {
    try {
      await officeService.deleteOffice(req.params.id);
      return noContent(res, 'Office deleted successfully');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new OfficeController();