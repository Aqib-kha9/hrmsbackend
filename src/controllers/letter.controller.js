const letterService = require('../services/letter.service');
const letterPdfService = require('../services/letter_pdf.service');
const emailService = require('../services/email.service');
const { LetterTemplate, Employee, Office, Company, AuthorisedSignatory } = require('../models');
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
      const { page, limit, type, status, search } = req.query;
      const result = await letterService.getAllLetters({ page, limit, type, status, search });
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
      const { templateId, template_id, employeeId, employee_id, content, title: bodyTitle, type: bodyType, candidateData, signatoryId, signatory_id, recordLetter } = params;
      const resolvedTemplateId = templateId || template_id;
      const resolvedEmployeeId = employeeId || employee_id;
      const resolvedSignatoryId = signatoryId || signatory_id;

      let signatory = null;
      if (resolvedSignatoryId) {
        signatory = await AuthorisedSignatory.findByPk(resolvedSignatoryId);
      }

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
        fullHtml: req.body?.fullHtml,
        employee,
        title,
        type,
        signatory,
      });

      if (recordLetter === true || recordLetter === 'true') {
        let letterRecord = null;
        if (resolvedEmployeeId) {
          letterRecord = await letterService.issueLetter({
            employee_id: resolvedEmployeeId,
            type,
            title,
            content: content || '',
            issued_date: new Date(),
            status: 'issued',
            signatory_id: resolvedSignatoryId || null,
          }, req.employee ? req.employee.id : null);
        } else if (candidateData) {
          letterRecord = await letterService.issueLetter({
            employee_id: null,
            candidate_name: candidateData.name || null,
            candidate_email: candidateData.email || null,
            candidate_phone: candidateData.phone || null,
            type,
            title,
            content: content || '',
            issued_date: new Date(),
            status: 'issued',
            signatory_id: resolvedSignatoryId || null,
          }, req.employee ? req.employee.id : null);
        }
        if (letterRecord) {
          res.setHeader('X-Letter-Id', String(letterRecord.id));
          res.setHeader('Access-Control-Expose-Headers', 'X-Letter-Id');
        }
      }

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
      const { templateId, template_id, employeeId, employee_id, content, fullHtml, title: bodyTitle, type: bodyType, subject, candidateData, signatoryId, signatory_id } = req.body;
      const resolvedTemplateId = templateId || template_id;
      const resolvedEmployeeId = employeeId || employee_id;
      const resolvedSignatoryId = signatoryId || signatory_id || null;

      let signatory = null;
      if (resolvedSignatoryId) {
        signatory = await AuthorisedSignatory.findByPk(resolvedSignatoryId);
      }

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
        signatory,
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
          signatory_id: resolvedSignatoryId,
        }, req.employee ? req.employee.id : null);
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
          signatory_id: resolvedSignatoryId,
        }, req.employee ? req.employee.id : null);
        letterId = letter.id;
      }

      // Send official email using email service
      const companyName = employee.company?.name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
      const emailResult = await emailService.sendOfficialLetterEmail({
        to: employee.email,
        employeeName: employee.name,
        empCode: employee.emp_code || '',
        letterTitle: title,
        letterType: type,
        companyName,
        pdfBuffer,
        customSubject: subject,
      });

      return success(res, `Letter sent successfully to registered email (${employee.email})`, {
        letter_id: letterId,
        recipient_email: employee.email,
        email_accepted: emailResult.accepted,
        email_rejected: emailResult.rejected,
      }, 200);
    } catch (err) {
      logger.error(`Send letter email error: ${err.message}`);
      return next(err);
    }
  }

  async sendExistingLetterEmail(req, res, next) {
    try {
      const { id } = req.params;
      const { recipient_email, custom_note, subject } = req.body || {};

      const { Letter } = require('../models');
      const letter = await Letter.findByPk(id, {
        include: [
          {
            model: Employee,
            as: 'issuedTo',
            include: [
              { model: Office, as: 'office', attributes: ['name', 'address', 'city', 'state'] },
              { model: Company, as: 'company', attributes: ['name', 'email', 'phone'] },
            ],
          },
          {
            model: AuthorisedSignatory,
            as: 'signatory',
          },
        ],
      });

      if (!letter) {
        return res.status(404).json({ success: false, message: 'Letter record not found' });
      }

      const targetEmail = recipient_email || letter.issuedTo?.email || letter.candidate_email;
      if (!targetEmail) {
        return res.status(400).json({ success: false, message: 'Recipient has no registered email address' });
      }

      const targetName = letter.issuedTo?.name || letter.candidate_name || 'Employee';
      const targetCode = letter.issuedTo?.emp_code || '';
      const companyName = letter.issuedTo?.company?.name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';

      // Generate PDF
      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: letter.content || '',
        fullHtml: req.body?.fullHtml,
        employee: letter.issuedTo || {
          name: targetName,
          emp_code: targetCode,
          email: targetEmail,
          company: { name: companyName },
        },
        title: letter.title,
        type: letter.type,
        signatory: letter.signatory,
      });

      // Send official email with attachment
      const emailResult = await emailService.sendOfficialLetterEmail({
        to: targetEmail,
        employeeName: targetName,
        empCode: targetCode,
        letterTitle: letter.title,
        letterType: letter.type,
        companyName,
        pdfBuffer,
        customSubject: subject,
        customNote: custom_note,
      });

      if (letter.status === 'draft') {
        await letter.update({ status: 'issued', issued_date: letter.issued_date || new Date() });
      }

      return success(res, `Letter dispatched successfully to registered email (${targetEmail})`, {
        letter_id: letter.id,
        recipient_email: targetEmail,
        email_accepted: emailResult.accepted,
        email_rejected: emailResult.rejected,
      }, 200);
    } catch (err) {
      logger.error(`Send existing letter email error: ${err.message}`);
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