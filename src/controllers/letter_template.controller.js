const letterTemplateService = require('../services/letter_template.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class LetterTemplateController {
  async getTemplates(req, res, next) {
    try {
      const { type, category, is_active, search, page, limit } = req.query;
      const result = await letterTemplateService.getTemplates({ type, category, is_active, search, page, limit });
      return paginated(res, 'Templates fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get templates error: ${err.message}`);
      return next(err);
    }
  }

  async getAllTemplates(req, res, next) {
    try {
      const { type, category, is_active } = req.query;
      const templates = await letterTemplateService.getAllTemplates({ type, category, is_active });
      return success(res, 'All templates fetched', templates, 200);
    } catch (err) {
      logger.error(`Get all templates error: ${err.message}`);
      return next(err);
    }
  }

  async getTemplateById(req, res, next) {
    try {
      const { id } = req.params;
      const template = await letterTemplateService.getTemplateById(id);
      return success(res, 'Template fetched', template, 200);
    } catch (err) {
      logger.error(`Get template by id error: ${err.message}`);
      return next(err);
    }
  }

  async createTemplate(req, res, next) {
    try {
      const template = await letterTemplateService.createTemplate(req.body, req.employee.id);
      return success(res, 'Template created', template, 201);
    } catch (err) {
      logger.error(`Create template error: ${err.message}`);
      return next(err);
    }
  }

  async updateTemplate(req, res, next) {
    try {
      const { id } = req.params;
      const template = await letterTemplateService.updateTemplate(id, req.body, req.employee.id);
      return success(res, 'Template updated', template, 200);
    } catch (err) {
      logger.error(`Update template error: ${err.message}`);
      return next(err);
    }
  }

  async deleteTemplate(req, res, next) {
    try {
      const { id } = req.params;
      await letterTemplateService.deleteTemplate(id);
      return success(res, 'Template deleted', null, 200);
    } catch (err) {
      logger.error(`Delete template error: ${err.message}`);
      return next(err);
    }
  }

  async previewTemplate(req, res, next) {
    try {
      const params = req.method === 'GET' ? req.query : req.body;
      const { templateId, employeeId, candidateData, signatoryId, signatory_id } = params;
      const resolvedSignatoryId = signatoryId || signatory_id || null;
      
      if (!templateId) {
        return res.status(400).json({ success: false, message: 'templateId is required' });
      }
      if (!employeeId && !candidateData) {
        return res.status(400).json({ success: false, message: 'Either employeeId or candidateData is required' });
      }
      
      const preview = await letterTemplateService.previewTemplate(templateId, employeeId, candidateData, resolvedSignatoryId);
      return success(res, 'Preview generated', preview, 200);
    } catch (err) {
      logger.error(`Preview template error: ${err.message}`);
      return next(err);
    }
  }

  async seedDefaultTemplates(req, res, next) {
    try {
      const force = req.query.force === 'true' || req.body?.force === true;
      const result = await letterTemplateService.seedDefaultTemplates(req.employee.id, { force });
      return success(res, 'Seed completed', result, 200);
    } catch (err) {
      logger.error(`Seed templates error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new LetterTemplateController();