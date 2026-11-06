const letterService = require('../services/letter.service');
const letterPdfService = require('../services/letter_pdf.service');
const emailService = require('../services/email.service');
const { LetterTemplate, Employee, Office, Company } = require('../models');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class LetterController {
  async getMyLetters(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { page, limit, type, status } = req.query;
      const result = await letterService.getLetters(employeeId, { page, limit, type, status });
      return paginated(res, 'Letters fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get my letters error: ${err.message}`);
      return next(err);
    }
  }

  async getLetterById(req, res, next) {
    try {
      const { id } = req.params;
      const result = await letterService.getLetterById(id, req.employee.id);
      return success(res, 'Letter fetched', result, 200);
    } catch (err) {
      logger.error(`Get letter by id error: ${err.message}`);
      return next(err);
    }
  }

  async acknowledgeLetter(req, res, next) {
    try {
      const { id } = req.params;
      const result = await letterService.acknowledgeLetter(id, req.employee.id);
      return success(res, 'Letter acknowledged', result, 200);
    } catch (err) {
      logger.error(`Acknowledge letter error: ${err.message}`);
      return next(err);
    }
  }

  async getAllLetters(req, res, next) {
    try {
      const { page, limit, type, status } = req.query;
      const result = await letterService.getAllLetters({ page, limit, type, status });
      return paginated(res, 'All letters fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get all letters error: ${err.message}`);
      return next(err);
    }
  }

  async issueLetter(req, res, next) {
    try {
      const letterData = req.body;
      const result = await letterService.issueLetter(letterData, req.employee.id);
      return success(res, 'Letter issued', result, 201);
    } catch (err) {
      logger.error(`Issue letter error: ${err.message}`);
      return next(err);
    }
  }

  async updateLetter(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const result = await letterService.updateLetter(id, updateData);
      return success(res, 'Letter updated', result, 200);
    } catch (err) {
      logger.error(`Update letter error: ${err.message}`);
      return next(err);
    }
  }

  async generateLetterPDF(req, res, next) {
    try {
      // Support both GET (query params) and POST (body)
      const params = req.method === 'GET' ? req.query : req.body;
      const { templateId, template_id, employeeId, employee_id, content, title: bodyTitle, type: bodyType, candidateData } = params;
      const resolvedTemplateId = templateId || template_id;
      const resolvedEmployeeId = employeeId || employee_id;

      let employee = null;
      if (resolvedEmployeeId) {
        employee = await Employee.findByPk(resolvedEmployeeId, {
          include: [
            { model: Office, as: 'office', attributes: ['name', 'address', 'city', 'state'] },
            { model: Company, as: 'company', attributes: ['name'] },
          ],
        });
        if (!employee) {
          return res.status(404).json({ success: false, message: 'Employee not found' });
        }
      } else if (candidateData) {
        employee = {
          id: 'candidate',
          name: candidateData.name || 'Candidate',
          emp_code: 'NEW',
          email: candidateData.email || '',
          phone: candidateData.phone || '',
          designation: candidateData.designation || 'TBD',
          department: candidateData.department || 'TBD',
          fixed_gross: candidateData.fixed_gross || 0,
          date_of_joining: candidateData.date_of_joining || new Date(),
          pf_applicable: candidateData.pf_applicable ?? true,
          pf_ceiling: candidateData.pf_ceiling ?? true,
          pf_contribution_mode: candidateData.pf_contribution_mode || 'shared',
          pf_employer_rate: Number(candidateData.pf_employer_rate ?? 0.12),
          pf_employee_rate: Number(candidateData.pf_employee_rate ?? 0.12),
          esic_applicable: candidateData.esic_applicable ?? true,
          esic_contribution_mode: candidateData.esic_contribution_mode || 'shared',
          esic_employer_rate: Number(candidateData.esic_employer_rate ?? 0.0325),
          esic_employee_rate: Number(candidateData.esic_employee_rate ?? 0.0075),
          office: { name: candidateData.office || 'Head Office', address: '', city: '', state: '' },
          company: { name: candidateData.company || 'BP Marketing' }
        };
      } else {
        return res.status(400).json({ success: false, message: 'Either employeeId or candidateData is required' });
      }

      let template = null;
      let title = 'Letter';
      let type = 'general';

      if (resolvedTemplateId) {
        template = await LetterTemplate.findByPk(resolvedTemplateId);
        if (template) {
          title = bodyTitle || template.name;
          type = bodyType || template.type;
        }
      }

      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: content || '',
        fullHtml: req.body.fullHtml,
        employee,
        title,
        type,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="letter-${employee.emp_code || 'employee'}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`Generate letter PDF error: ${err.message}`);
      return next(err);
    }
  }

  async sendLetterEmail(req, res, next) {
    try {
      const { templateId, template_id, employeeId, employee_id, content, fullHtml, title: bodyTitle, type: bodyType, subject, candidateData } = req.body;
      const resolvedTemplateId = templateId || template_id;
      const resolvedEmployeeId = employeeId || employee_id;

      let employee = null;
      if (resolvedEmployeeId) {
        employee = await Employee.findByPk(resolvedEmployeeId, {
          include: [
            { model: Office, as: 'office', attributes: ['name', 'address', 'city', 'state'] },
            { model: Company, as: 'company', attributes: ['name'] },
          ],
        });
        if (!employee) {
          return res.status(404).json({ success: false, message: 'Employee not found' });
        }
      } else if (candidateData) {
        employee = {
          id: 'candidate',
          name: candidateData.name || 'Candidate',
          emp_code: 'NEW',
          email: candidateData.email || '',
          phone: candidateData.phone || '',
          designation: candidateData.designation || 'TBD',
          department: candidateData.department || 'TBD',
          fixed_gross: candidateData.fixed_gross || 0,
          date_of_joining: candidateData.date_of_joining || new Date(),
          pf_applicable: candidateData.pf_applicable ?? true,
          pf_ceiling: candidateData.pf_ceiling ?? true,
          pf_contribution_mode: candidateData.pf_contribution_mode || 'shared',
          pf_employer_rate: Number(candidateData.pf_employer_rate ?? 0.12),
          pf_employee_rate: Number(candidateData.pf_employee_rate ?? 0.12),
          esic_applicable: candidateData.esic_applicable ?? true,
          esic_contribution_mode: candidateData.esic_contribution_mode || 'shared',
          esic_employer_rate: Number(candidateData.esic_employer_rate ?? 0.0325),
          esic_employee_rate: Number(candidateData.esic_employee_rate ?? 0.0075),
          office: { name: candidateData.office || 'Head Office', address: '', city: '', state: '' },
          company: { name: candidateData.company || 'BP Marketing' }
        };
      } else {
        return res.status(400).json({ success: false, message: 'Either employeeId or candidateData is required' });
      }

      if (!employee.email) {
        return res.status(400).json({ success: false, message: 'Recipient has no email address' });
      }

      let template = null;
      let title = 'Letter';
      let type = 'general';

      if (resolvedTemplateId) {
        template = await LetterTemplate.findByPk(resolvedTemplateId);
        if (template) {
          title = bodyTitle || template.name;
          type = bodyType || template.type;
        }
      }

      // Generate PDF
      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: content || '',
        fullHtml,
        employee,
        title,
        type,
      });

      let letterId = null;
      if (resolvedEmployeeId) {
        const letter = await letterService.issueLetter({
          employee_id: resolvedEmployeeId,
          type,
          title,
          content: content || '',
          issued_date: new Date(),
          status: 'issued',
          signatory_id: req.body.signatory_id || null,
        }, req.employee.id);
        letterId = letter.id;
      } else if (candidateData) {
        const letter = await letterService.issueLetter({
          employee_id: null,
          candidate_name: candidateData.name || null,
          candidate_email: candidateData.email || null,
          candidate_phone: candidateData.phone || null,
          type,
          title,
          content: content || '',
          issued_date: new Date(),
          status: 'issued',
          signatory_id: req.body.signatory_id || null,
        }, req.employee.id);
        letterId = letter.id;
      }

      // Send email
      const emailSubject = subject || `${title} - ${employee.company?.name || 'Company'}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e293b;">${title}</h2>
          <p>Dear ${employee.name},</p>
          <p>Please find attached your ${title.toLowerCase()}.</p>
          <p>If you have any questions, please contact the HR department.</p>
          <br/>
          <p style="color: #64748b;">Regards,<br/>HR Department<br/>${employee.company?.name || ''}</p>
        </div>
      `;

      const emailResult = await emailService.sendMail({
        to: employee.email,
        subject: emailSubject,
        html: emailHtml,
        attachments: [{
          filename: `${type}-${employee.emp_code || 'employee'}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });

      return success(res, 'Letter sent successfully', {
        letter_id: letterId,
        email_accepted: emailResult.accepted,
        email_rejected: emailResult.rejected,
      }, 200);
    } catch (err) {
      logger.error(`Send letter email error: ${err.message}`);
      return next(err);
    }
  }

  async deleteLetter(req, res, next) {
    try {
      const { id } = req.params;
      await letterService.deleteLetter(id);
      return success(res, 'Letter deleted', null, 200);
    } catch (err) {
      logger.error(`Delete letter error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new LetterController();