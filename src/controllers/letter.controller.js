const crypto = require('crypto');
const letterService = require('../services/letter.service');
const letterPdfService = require('../services/letter_pdf.service');
const letterTemplateService = require('../services/letter_template.service');
const emailService = require('../services/email.service');
const { Letter, LetterTemplate, Employee, Office, Company, AuthorisedSignatory, Role, OnboardingInvitation, sequelize } = require('../models');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');
const env = require('../config/env');
const { PAGINATION } = require('../utils/constants');

/**
 * Helper to locate an offer letter by its digital acceptance token
 */
async function findLetterByAcceptanceToken(token) {
  if (!token) return null;
  try {
    const letter = await Letter.findOne({
      where: sequelize.where(
        sequelize.fn('JSON_UNQUOTE', sequelize.fn('JSON_EXTRACT', sequelize.col('metadata'), '$.acceptance_token')),
        token
      ),
      include: [
        {
          model: Employee,
          as: 'issuedTo',
          include: [
            { model: Office, as: 'office' },
            { model: Company, as: 'company' },
          ],
        },
        {
          model: AuthorisedSignatory,
          as: 'signatory',
        },
      ],
    });
    if (letter) return letter;
  } catch (err) {
    logger.warn(`JSON_EXTRACT lookup failed (${err.message}), falling back to scan`);
  }

  // Fallback: search recent offer or appointment letters
  const letters = await Letter.findAll({
    where: { type: ['offer', 'appointment'] },
    order: [['id', 'DESC']],
    limit: 500,
    include: [
      {
        model: Employee,
        as: 'issuedTo',
        include: [
          { model: Office, as: 'office' },
          { model: Company, as: 'company' },
        ],
      },
      {
        model: AuthorisedSignatory,
        as: 'signatory',
      },
    ],
  });

  return letters.find(l => {
    const meta = typeof l.metadata === 'string' ? JSON.parse(l.metadata || '{}') : (l.metadata || {});
    return meta && meta.acceptance_token === token;
  }) || null;
}

class LetterController {
  constructor() {
    // Auto-bind all methods so Express route handlers never lose `this` context
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  async getMyLetters(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const { page, limit, type, status } = req.query;
      const result = await letterService.getLetters(employeeId, {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : PAGINATION.DEFAULT_LIMIT,
        type,
        status,
      });
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
      const result = await letterService.getAllLetters({
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : PAGINATION.DEFAULT_LIMIT,
        type,
        status,
        search,
      });
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
        let onboardingLink = null;
        let onboardingInvitation = null;

        if (params.includeOnboarding && candidateData && candidateData.email) {
          try {
            const onboardingInvitationService = require('../services/onboarding_invitation.service');
            let company_id = candidateData.company_id || null;
            if (!company_id && candidateData.company) {
              const comp = await Company.findOne({ where: { name: candidateData.company } });
              if (comp) company_id = comp.id;
            }
            let office_id = candidateData.office_id || null;
            if (!office_id && candidateData.office) {
              const off = await Office.findOne({ where: { name: candidateData.office } });
              if (off) office_id = off.id;
            }

            const inviteResult = await onboardingInvitationService.createInvitation({
              email: candidateData.email.trim(),
              candidate_name: candidateData.name || null,
              phone: candidateData.phone || null,
              designation: candidateData.designation || null,
              department: candidateData.department || null,
              office_id,
              company_id,
              fixed_gross: parseFloat(candidateData.fixed_gross) || 0,
              expiry_days: 7,
              send_email: false,
            }, req.employee ? req.employee.id : null);

            onboardingInvitation = inviteResult.invitation;
            onboardingLink = inviteResult.link;
          } catch (e) {
            logger.warn(`Could not create onboarding invitation during PDF recording: ${e.message}`);
          }
        }

        const letterMetadata = {
          candidate_details: candidateData || null,
          onboarding_link: onboardingLink || null,
          onboarding_invitation_id: onboardingInvitation ? onboardingInvitation.id : null,
        };

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
            metadata: letterMetadata,
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
            metadata: letterMetadata,
          }, req.employee ? req.employee.id : null);
        }
        if (letterRecord) {
          res.setHeader('X-Letter-Id', String(letterRecord.id));
          if (onboardingLink) {
            res.setHeader('X-Onboarding-Link', encodeURIComponent(onboardingLink));
          }
          res.setHeader('Access-Control-Expose-Headers', 'X-Letter-Id, X-Onboarding-Link');
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
      const { templateId, template_id, employeeId, employee_id, content, fullHtml, title: bodyTitle, type: bodyType, subject, candidateData, signatoryId, signatory_id, includeOnboarding } = req.body;
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

      // ── Digital Acceptance Link generation for Offer & Appointment letters ──
      const isOfferLetter = type === 'offer' || bodyType === 'offer' || !!candidateData;
      const isAppointmentLetter = type === 'appointment' || bodyType === 'appointment';
      const requiresDigitalSignature = isOfferLetter || isAppointmentLetter;
      let acceptanceToken = null;
      let acceptanceLink = null;
      const frontendUrl = env.APP_URL || env.FRONTEND_URL || 'http://localhost:3000';

      if (requiresDigitalSignature) {
        acceptanceToken = crypto.randomBytes(32).toString('hex');
        const pagePath = isAppointmentLetter ? 'appointment-acceptance' : 'offer-acceptance';
        acceptanceLink = `${frontendUrl}/${pagePath}?token=${acceptanceToken}`;
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
      const letterMetadata = {
        candidate_details: candidateData || null,
        onboarding_link: null,
        onboarding_invitation_id: null,
        onboarding_invited: false,
        acceptance_token: acceptanceToken,
        acceptance_status: requiresDigitalSignature ? 'pending' : null,
        candidate_signature: null,
        signed_name: null,
        accepted_at: null,
        rejection_reason: null,
      };

      if (resolvedEmployeeId) {
        const letter = await letterService.issueLetter({
          employee_id: resolvedEmployeeId,
          type,
          title,
          content: content || '',
          issued_date: new Date(),
          status: 'issued',
          signatory_id: resolvedSignatoryId,
          metadata: letterMetadata,
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
          metadata: letterMetadata,
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
        acceptanceLink,
      });

      return success(res, `Letter sent successfully to registered email (${employee.email})`, {
        letter_id: letterId,
        recipient_email: employee.email,
        acceptance_token: acceptanceToken,
        acceptance_link: acceptanceLink,
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

      // Digital offer acceptance link
      const isOfferLetter = letter.type === 'offer';
      const isAppointmentLetter = letter.type === 'appointment';
      const requiresDigitalSignature = isOfferLetter || isAppointmentLetter;
      let acceptanceLink = null;
      const frontendUrl = env.APP_URL || env.FRONTEND_URL || 'http://localhost:3000';
      let meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});

      if (requiresDigitalSignature) {
        if (!meta.acceptance_token) {
          meta.acceptance_token = crypto.randomBytes(32).toString('hex');
          meta.acceptance_status = meta.acceptance_status || 'pending';
          await letter.update({ metadata: meta });
        }
        const pagePath = isAppointmentLetter ? 'appointment-acceptance' : 'offer-acceptance';
        acceptanceLink = `${frontendUrl}/${pagePath}?token=${meta.acceptance_token}`;
      }

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
        metadata: meta,
        letterDate: letter.issued_date,
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
        acceptanceLink,
      });

      if (letter.status === 'draft') {
        await letter.update({ status: 'issued', issued_date: letter.issued_date || new Date() });
      }

      return success(res, `Letter dispatched successfully to registered email (${targetEmail})`, {
        letter_id: letter.id,
        recipient_email: targetEmail,
        acceptance_link: acceptanceLink,
        email_accepted: emailResult.accepted,
        email_rejected: emailResult.rejected,
      }, 200);
    } catch (err) {
      logger.error(`Send existing letter email error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * Generic Public: Retrieve any letter details (offer or appointment) by digital acceptance token
   */
  async getPublicLetter(req, res, next) {
    try {
      const { token } = req.params;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Acceptance token is required' });
      }

      const letter = await findLetterByAcceptanceToken(token);
      if (!letter) {
        return res.status(404).json({ success: false, message: 'Letter not found or link has expired' });
      }

      const meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
      const candidateInfo = meta.candidate_details || {};

      const candidateName = letter.candidate_name || letter.issuedTo?.name || candidateInfo.name || 'Candidate';
      const candidateEmail = letter.candidate_email || letter.issuedTo?.email || candidateInfo.email || '';
      const candidatePhone = letter.candidate_phone || letter.issuedTo?.phone || candidateInfo.phone || '';
      const designation = candidateInfo.designation || letter.issuedTo?.designation || 'Specialist';
      const department = candidateInfo.department || letter.issuedTo?.department || 'Operations';
      const companyName = candidateInfo.company || letter.issuedTo?.company?.name || 'BP Marketing';
      const officeName = candidateInfo.office || letter.issuedTo?.office?.name || 'Head Office';
      const fixedGross = candidateInfo.fixed_gross || letter.issuedTo?.fixed_gross || 0;
      const dateOfJoining = candidateInfo.date_of_joining || letter.issuedTo?.date_of_joining || null;
      const empCode = letter.issuedTo?.emp_code || candidateInfo.emp_code || 'NEW';

      return success(res, `${letter.type === 'appointment' ? 'Appointment' : 'Offer'} letter retrieved successfully`, {
        id: letter.id,
        title: letter.title,
        type: letter.type,
        content: letter.content,
        status: letter.status,
        issued_date: letter.issued_date,
        acceptance_status: meta.acceptance_status || (letter.status === 'acknowledged' ? 'accepted' : 'pending'),
        candidate: {
          name: candidateName,
          emp_code: empCode,
          email: candidateEmail,
          phone: candidatePhone,
          designation,
          department,
          company: companyName,
          office: officeName,
          fixed_gross: fixedGross,
          date_of_joining: dateOfJoining,
        },
        signatory: letter.signatory ? {
          name: letter.signatory.name,
          designation: letter.signatory.designation,
          signature_url: letter.signatory.signature_url,
        } : null,
        response_details: {
          accepted_at: meta.accepted_at || letter.acknowledged_at || null,
          rejected_at: meta.rejected_at || null,
          signed_name: meta.signed_name || null,
          candidate_signature: meta.candidate_signature || null,
          candidate_comments: meta.candidate_comments || null,
          rejection_reason: meta.rejection_reason || null,
        },
        onboarding_invited: !!meta.onboarding_invited,
      }, 200);
    } catch (err) {
      logger.error(`Get public letter error: ${err.message}`);
      return next(err);
    }
  }

  async getPublicOfferLetter(req, res, next) {
    return (this?.getPublicLetter || LetterController.prototype.getPublicLetter)(req, res, next);
  }

  async getPublicAppointmentLetter(req, res, next) {
    return (this?.getPublicLetter || LetterController.prototype.getPublicLetter)(req, res, next);
  }

  /**
   * Public: Accept or decline letter with digital signature
   */
  async respondPublicLetter(req, res, next) {
    try {
      const { token } = req.params;
      const { action, signature, signed_name, comments, reason } = req.body;

      if (!token) {
        return res.status(400).json({ success: false, message: 'Acceptance token is required' });
      }

      if (!action || !['accept', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Action must be either "accept" or "reject"' });
      }

      const letter = await findLetterByAcceptanceToken(token);
      if (!letter) {
        return res.status(404).json({ success: false, message: 'Letter not found or link has expired' });
      }

      let meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});

      if (meta.acceptance_status === 'accepted') {
        return res.status(400).json({ success: false, message: `This ${letter.type === 'appointment' ? 'appointment' : 'offer'} letter has already been accepted and digitally signed` });
      }
      if (meta.acceptance_status === 'rejected') {
        return res.status(400).json({ success: false, message: `This ${letter.type === 'appointment' ? 'appointment' : 'offer'} letter has already been declined` });
      }

      const candidateInfo = meta.candidate_details || {};
      const candidateName = signed_name || letter.candidate_name || letter.issuedTo?.name || candidateInfo.name || 'Candidate';
      const candidateEmail = letter.candidate_email || letter.issuedTo?.email || candidateInfo.email || '';
      const designation = candidateInfo.designation || letter.issuedTo?.designation || 'Specialist';
      const companyName = candidateInfo.company || letter.issuedTo?.company?.name || 'BP Marketing';
      const empCode = letter.issuedTo?.emp_code || candidateInfo.emp_code || '';

      // Find HR recipient for notifications
      let hrEmail = null;
      if (letter.issued_by) {
        const issuer = await Employee.findByPk(letter.issued_by);
        if (issuer?.email) hrEmail = issuer.email;
      }
      if (!hrEmail) {
        const hrUser = await Employee.findOne({
          where: { status: 'active' },
          include: [{ model: Role, as: 'role', where: { name: ['hr', 'admin', 'super_admin'] } }],
        });
        hrEmail = hrUser?.email || env.SMTP_USER || 'hr@apaarlogistics.com';
      }

      if (action === 'accept') {
        if (!signature) {
          return res.status(400).json({ success: false, message: 'Digital signature is required to accept the document' });
        }

        const acceptedAt = new Date().toISOString();
        meta = {
          ...meta,
          acceptance_status: 'accepted',
          candidate_signature: signature,
          signed_name: candidateName,
          accepted_at: acceptedAt,
          candidate_comments: comments || null,
        };

        await letter.update({
          metadata: meta,
          status: 'acknowledged',
          acknowledged_at: new Date(),
        });

        // Also if linked to an onboarding invitation, update invitation appointment_status
        if (meta.invitation_id) {
          try {
            const inv = await OnboardingInvitation.findByPk(meta.invitation_id);
            if (inv && inv.submitted_data) {
              const subData = { ...inv.submitted_data, appointment_status: 'accepted', appointment_signed_at: acceptedAt };
              inv.submitted_data = subData;
              await inv.save();
            }
          } catch (e) {
            logger.warn(`Could not update invitation appointment status: ${e.message}`);
          }
        }

        // Notify HR via email
        try {
          if (letter.type === 'appointment') {
            await emailService.sendAppointmentAcceptedNotification({
              to: hrEmail,
              employeeName: candidateName,
              empCode,
              employeeEmail: candidateEmail,
              designation,
              companyName,
              acceptedAt,
            });
          } else {
            await emailService.sendOfferAcceptedNotification({
              to: hrEmail,
              candidateName,
              candidateEmail,
              designation,
              companyName,
              acceptedAt,
            });
          }
        } catch (mailErr) {
          logger.error(`Failed to send acceptance notification to HR: ${mailErr.message}`);
        }

        return success(res, `${letter.type === 'appointment' ? 'Appointment' : 'Offer'} letter accepted and digitally signed successfully!`, {
          status: 'accepted',
          accepted_at: acceptedAt,
          candidate_name: candidateName,
        }, 200);
      } else {
        // Reject
        const rejectedAt = new Date().toISOString();
        meta = {
          ...meta,
          acceptance_status: 'rejected',
          rejection_reason: reason || 'Declined by candidate/employee',
          rejected_at: rejectedAt,
        };

        await letter.update({
          metadata: meta,
          status: 'revoked',
        });

        // Notify HR via email
        try {
          await emailService.sendOfferRejectedNotification({
            to: hrEmail,
            candidateName,
            candidateEmail,
            designation,
            companyName,
            rejectedAt,
            reason: reason || 'No specific reason provided',
          });
        } catch (mailErr) {
          logger.error(`Failed to send rejection notification to HR: ${mailErr.message}`);
        }

        return success(res, `${letter.type === 'appointment' ? 'Appointment' : 'Offer'} letter response recorded.`, {
          status: 'rejected',
          rejected_at: rejectedAt,
        }, 200);
      }
    } catch (err) {
      logger.error(`Respond public letter error: ${err.message}`);
      return next(err);
    }
  }

  async respondPublicOfferLetter(req, res, next) {
    return (this?.respondPublicLetter || LetterController.prototype.respondPublicLetter)(req, res, next);
  }

  async respondPublicAppointmentLetter(req, res, next) {
    return (this?.respondPublicLetter || LetterController.prototype.respondPublicLetter)(req, res, next);
  }

  /**
   * Public: Download official letter PDF by token
   */
  async downloadPublicLetterPDF(req, res, next) {
    try {
      const { token } = req.params;
      const letter = await findLetterByAcceptanceToken(token);
      if (!letter) {
        return res.status(404).json({ success: false, message: 'Letter not found' });
      }

      const meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
      const candidateInfo = meta.candidate_details || {};

      const employeeObj = letter.issuedTo || {
        name: letter.candidate_name || candidateInfo.name || 'Candidate',
        emp_code: candidateInfo.emp_code || 'NEW',
        email: letter.candidate_email || candidateInfo.email || '',
        phone: letter.candidate_phone || candidateInfo.phone || '',
        designation: candidateInfo.designation || 'Specialist',
        department: candidateInfo.department || 'Operations',
        company: { name: candidateInfo.company || 'BP Marketing' },
        office: { name: candidateInfo.office || 'Head Office', address: '' },
      };

      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: letter.content || '',
        employee: employeeObj,
        title: letter.title,
        type: letter.type,
        signatory: letter.signatory,
        metadata: meta,
        letterDate: letter.issued_date,
      });

      const filename = `${letter.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`Download public letter PDF error: ${err.message}`);
      return next(err);
    }
  }

  async downloadPublicOfferLetterPDF(req, res, next) {
    return (this?.downloadPublicLetterPDF || LetterController.prototype.downloadPublicLetterPDF)(req, res, next);
  }

  async downloadPublicAppointmentLetterPDF(req, res, next) {
    return (this?.downloadPublicLetterPDF || LetterController.prototype.downloadPublicLetterPDF)(req, res, next);
  }

  /**
   * Admin/HR: 1-Click issue and email Appointment Letter with digital signing link
   */
  async issueAndSendAppointmentLetter(req, res, next) {
    try {
      const { invitationId, invitation_id, employeeId, employee_id, signatoryId, signatory_id } = req.body;
      const resolvedInvId = req.params.id || invitationId || invitation_id;
      let resolvedEmpId = employeeId || employee_id;

      let invitation = null;
      if (resolvedInvId) {
        invitation = await OnboardingInvitation.findByPk(resolvedInvId);
      }

      let employee = null;
      if (resolvedEmpId) {
        employee = await Employee.findByPk(resolvedEmpId, {
          include: [
            { model: Office, as: 'office' },
            { model: Company, as: 'company' },
          ],
        });
      } else if (invitation) {
        employee = await Employee.findOne({
          where: { email: invitation.email },
          include: [
            { model: Office, as: 'office' },
            { model: Company, as: 'company' },
          ],
        });
      }

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: 'Employee not found. Please ensure candidate onboarding is approved before issuing the appointment letter.'
        });
      }

      // Resolve Signatory
      const resolvedSigId = signatoryId || signatory_id;
      let signatory = null;
      if (resolvedSigId) {
        signatory = await AuthorisedSignatory.findByPk(resolvedSigId);
      }
      if (!signatory) {
        signatory = await AuthorisedSignatory.findOne({ where: { is_active: true } });
      }

      // Find or seed Appointment Letter template
      let template = await LetterTemplate.findOne({
        where: { type: 'appointment', is_active: true },
      });
      if (!template) {
        await letterTemplateService.seedDefaultTemplates(req.employee ? req.employee.id : 1);
        template = await LetterTemplate.findOne({
          where: { type: 'appointment', is_active: true },
        });
      }

      // Populate template with employee's actual details & Annexure A
      let content = '';
      if (template) {
        const previewRes = await letterTemplateService.previewTemplate(template.id, employee.id, null, signatory ? signatory.id : null);
        content = previewRes.content;
      } else {
        content = `<p>Dear <strong>${employee.name}</strong>,</p><p>We are delighted to confirm your appointment as <strong>${employee.designation || 'Staff'}</strong> at <strong>${employee.company?.name || 'BP Marketing'}</strong>.</p>`;
      }

      // Generate digital acceptance token & link
      const acceptanceToken = crypto.randomBytes(32).toString('hex');
      const frontendUrl = env.APP_URL || env.FRONTEND_URL || 'http://localhost:3000';
      const acceptanceLink = `${frontendUrl}/appointment-acceptance?token=${acceptanceToken}`;

      const title = `Appointment Letter - ${employee.name} (${employee.emp_code || 'NEW'})`;
      const letterMetadata = {
        candidate_details: {
          name: employee.name,
          emp_code: employee.emp_code,
          email: employee.email,
          phone: employee.phone,
          designation: employee.designation,
          department: employee.department,
          company: employee.company?.name || 'BP Marketing',
          office: employee.office?.name || employee.location || 'Head Office',
          fixed_gross: employee.fixed_gross,
          date_of_joining: employee.date_of_joining,
        },
        invitation_id: invitation ? invitation.id : null,
        acceptance_token: acceptanceToken,
        acceptance_status: 'pending',
        acceptance_link: acceptanceLink,
        candidate_signature: null,
        signed_name: null,
        accepted_at: null,
        rejection_reason: null,
      };

      // Create Letter record
      const letter = await letterService.issueLetter({
        employee_id: employee.id,
        type: 'appointment',
        title,
        content,
        issued_date: new Date(),
        status: 'issued',
        signatory_id: signatory ? signatory.id : null,
        metadata: letterMetadata,
      }, req.employee ? req.employee.id : null);

      // Generate PDF
      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content,
        employee,
        title,
        type: 'appointment',
        signatory,
        metadata: letterMetadata,
        letterDate: new Date(),
      });

      // Send official email
      const companyName = employee.company?.name || 'BP Marketing';
      const emailResult = await emailService.sendOfficialLetterEmail({
        to: employee.email,
        employeeName: employee.name,
        empCode: employee.emp_code || '',
        letterTitle: title,
        letterType: 'appointment',
        companyName,
        pdfBuffer,
        acceptanceLink,
      });

      // If linked to an onboarding invitation, update invitation submitted_data
      if (invitation) {
        const subData = invitation.submitted_data || {};
        subData.appointment_letter_id = letter.id;
        subData.appointment_status = 'sent';
        subData.appointment_token = acceptanceToken;
        subData.appointment_sent_at = new Date().toISOString();
        invitation.submitted_data = subData;
        await invitation.save();
      }

      return success(res, `Appointment letter generated and emailed to ${employee.email} successfully!`, {
        letter_id: letter.id,
        acceptance_link: acceptanceLink,
        acceptance_token: acceptanceToken,
        email_sent: emailResult.accepted?.length > 0,
      }, 201);
    } catch (err) {
      logger.error(`Issue and send appointment letter error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * Admin/HR: Download official PDF for any issued letter by ID (consistent executive layout)
   */
  async downloadLetterByIdPDF(req, res, next) {
    try {
      const { id } = req.params;
      const letter = await Letter.findByPk(id, {
        include: [
          {
            model: Employee,
            as: 'issuedTo',
            include: [
              { model: Office, as: 'office' },
              { model: Company, as: 'company' },
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

      const meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
      const candidateInfo = meta.candidate_details || {};

      const employeeObj = letter.issuedTo || {
        name: letter.candidate_name || candidateInfo.name || 'Candidate',
        emp_code: 'NEW',
        email: letter.candidate_email || candidateInfo.email || '',
        phone: letter.candidate_phone || candidateInfo.phone || '',
        designation: candidateInfo.designation || 'Specialist',
        department: candidateInfo.department || 'Operations',
        company: { name: candidateInfo.company || 'BP Marketing' },
        office: { name: candidateInfo.office || 'Head Office', address: '' },
      };

      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: letter.content || '',
        employee: employeeObj,
        title: letter.title,
        type: letter.type,
        signatory: letter.signatory,
        metadata: meta,
        letterDate: letter.issued_date,
      });

      const recipientCode = letter.issuedTo?.emp_code || (letter.candidate_name ? letter.candidate_name.replace(/\s+/g, '_') : 'recipient');
      const filename = `${letter.type || 'letter'}-${recipientCode}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`Download letter by ID PDF error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * Admin/HR: Send 1-Click Onboarding Portal Invitation for an accepted offer letter
   */
  async sendOnboardingInvite(req, res, next) {
    try {
      const { id } = req.params;
      const onboardingInvitationService = require('../services/onboarding_invitation.service');

      const letter = await Letter.findByPk(id, {
        include: [
          {
            model: Employee,
            as: 'issuedTo',
            include: [
              { model: Office, as: 'office' },
              { model: Company, as: 'company' },
            ],
          },
        ],
      });

      if (!letter) {
        return res.status(404).json({ success: false, message: 'Letter record not found' });
      }

      let meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
      const cand = meta.candidate_details || {};

      const email = cand.email || letter.candidate_email || letter.issuedTo?.email;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Candidate email address is missing' });
      }

      const candidate_name = cand.name || letter.candidate_name || letter.issuedTo?.name || 'Candidate';
      const phone = cand.phone || letter.candidate_phone || letter.issuedTo?.phone || null;
      const designation = cand.designation || letter.issuedTo?.designation || null;
      const department = cand.department || letter.issuedTo?.department || null;
      const fixed_gross = parseFloat(cand.fixed_gross || letter.issuedTo?.fixed_gross || 0);

      let company_id = cand.company_id || letter.issuedTo?.company_id || null;
      if (!company_id && cand.company) {
        const comp = await Company.findOne({ where: { name: cand.company } });
        if (comp) company_id = comp.id;
      }

      let office_id = cand.office_id || letter.issuedTo?.office_id || null;
      if (!office_id && cand.office) {
        const off = await Office.findOne({ where: { name: cand.office } });
        if (off) office_id = off.id;
      }

      // Create and send official onboarding invitation email
      const inviteResult = await onboardingInvitationService.createInvitation({
        email: email.trim(),
        candidate_name,
        phone,
        designation,
        department,
        office_id,
        company_id,
        fixed_gross,
        expiry_days: 7,
        send_email: true, // Auto-send onboarding email!
      }, req.employee ? req.employee.id : null);

      meta = {
        ...meta,
        onboarding_invited: true,
        onboarding_link: inviteResult.link,
        onboarding_invitation_id: inviteResult.invitation?.id,
        onboarding_invited_at: new Date().toISOString(),
      };

      await letter.update({ metadata: meta });

      return success(res, `Self-onboarding portal link sent successfully to ${candidate_name} (${email})!`, {
        link: inviteResult.link,
        invitation_id: inviteResult.invitation?.id,
        reissued: inviteResult.reissued || false,
      }, 200);
    } catch (err) {
      logger.error(`Send onboarding invite error: ${err.message}`);
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