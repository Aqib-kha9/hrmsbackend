const crypto = require('crypto');
const letterService = require('../services/letter.service');
const letterPdfService = require('../services/letter_pdf.service');
const emailService = require('../services/email.service');
const { Letter, LetterTemplate, Employee, Office, Company, AuthorisedSignatory, Role, sequelize } = require('../models');
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

  // Fallback: search recent offer letters
  const letters = await Letter.findAll({
    where: { type: 'offer' },
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

      // ── Digital Offer Acceptance Link generation ──
      const isOfferLetter = type === 'offer' || bodyType === 'offer' || !!candidateData;
      let acceptanceToken = null;
      let acceptanceLink = null;
      const frontendUrl = env.APP_URL || env.FRONTEND_URL || 'http://localhost:3000';

      if (isOfferLetter) {
        acceptanceToken = crypto.randomBytes(32).toString('hex');
        acceptanceLink = `${frontendUrl}/offer-acceptance?token=${acceptanceToken}`;
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
        acceptance_status: isOfferLetter ? 'pending' : null,
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
      let acceptanceLink = null;
      const frontendUrl = env.APP_URL || env.FRONTEND_URL || 'http://localhost:3000';

      if (isOfferLetter) {
        let meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
        if (!meta.acceptance_token) {
          meta.acceptance_token = crypto.randomBytes(32).toString('hex');
          meta.acceptance_status = meta.acceptance_status || 'pending';
          await letter.update({ metadata: meta });
        }
        acceptanceLink = `${frontendUrl}/offer-acceptance?token=${meta.acceptance_token}`;
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
   * Public: Retrieve offer letter details by digital acceptance token
   */
  async getPublicOfferLetter(req, res, next) {
    try {
      const { token } = req.params;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Acceptance token is required' });
      }

      const letter = await findLetterByAcceptanceToken(token);
      if (!letter) {
        return res.status(404).json({ success: false, message: 'Offer letter not found or link has expired' });
      }

      const meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});
      const candidateInfo = meta.candidate_details || {};

      const candidateName = letter.candidate_name || letter.issuedTo?.name || candidateInfo.name || 'Candidate';
      const candidateEmail = letter.candidate_email || letter.issuedTo?.email || candidateInfo.email || '';
      const candidatePhone = letter.candidate_phone || letter.issuedTo?.phone || candidateInfo.phone || '';
      const designation = candidateInfo.designation || letter.issuedTo?.designation || 'Specialist';
      const department = candidateInfo.department || letter.issuedTo?.department || 'Operations';
      const companyName = candidateInfo.company || letter.issuedTo?.company?.name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
      const officeName = candidateInfo.office || letter.issuedTo?.office?.name || 'Head Office';
      const fixedGross = candidateInfo.fixed_gross || letter.issuedTo?.fixed_gross || 0;

      return success(res, 'Offer letter retrieved successfully', {
        id: letter.id,
        title: letter.title,
        type: letter.type,
        content: letter.content,
        status: letter.status,
        issued_date: letter.issued_date,
        acceptance_status: meta.acceptance_status || (letter.status === 'acknowledged' ? 'accepted' : 'pending'),
        candidate: {
          name: candidateName,
          email: candidateEmail,
          phone: candidatePhone,
          designation,
          department,
          company: companyName,
          office: officeName,
          fixed_gross: fixedGross,
          date_of_joining: candidateInfo.date_of_joining || null,
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
      logger.error(`Get public offer letter error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * Public: Accept or decline offer letter with digital signature
   */
  async respondPublicOfferLetter(req, res, next) {
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
        return res.status(404).json({ success: false, message: 'Offer letter not found or link has expired' });
      }

      let meta = typeof letter.metadata === 'string' ? JSON.parse(letter.metadata || '{}') : (letter.metadata || {});

      if (meta.acceptance_status === 'accepted') {
        return res.status(400).json({ success: false, message: 'This offer letter has already been accepted and digitally signed' });
      }
      if (meta.acceptance_status === 'rejected') {
        return res.status(400).json({ success: false, message: 'This offer letter has already been declined' });
      }

      const candidateInfo = meta.candidate_details || {};
      const candidateName = signed_name || letter.candidate_name || letter.issuedTo?.name || candidateInfo.name || 'Candidate';
      const candidateEmail = letter.candidate_email || letter.issuedTo?.email || candidateInfo.email || '';
      const designation = candidateInfo.designation || letter.issuedTo?.designation || 'Specialist';
      const companyName = candidateInfo.company || letter.issuedTo?.company?.name || 'Apaar Logistics';

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
          return res.status(400).json({ success: false, message: 'Digital signature is required to accept the offer' });
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

        // Notify HR via email
        try {
          await emailService.sendOfferAcceptedNotification({
            to: hrEmail,
            candidateName,
            candidateEmail,
            designation,
            companyName,
            acceptedAt,
          });
        } catch (mailErr) {
          logger.error(`Failed to send offer accepted notification to HR: ${mailErr.message}`);
        }

        return success(res, 'Offer letter accepted and digitally signed successfully!', {
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
          rejection_reason: reason || 'Candidate declined the offer',
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
          logger.error(`Failed to send offer rejected notification to HR: ${mailErr.message}`);
        }

        return success(res, 'Offer letter declined.', {
          status: 'rejected',
          rejected_at: rejectedAt,
        }, 200);
      }
    } catch (err) {
      logger.error(`Respond public offer letter error: ${err.message}`);
      return next(err);
    }
  }

  /**
   * Public: Download official offer letter PDF
   */
  async downloadPublicOfferLetterPDF(req, res, next) {
    try {
      const { token } = req.params;
      const letter = await findLetterByAcceptanceToken(token);
      if (!letter) {
        return res.status(404).json({ success: false, message: 'Offer letter not found' });
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
        company: { name: candidateInfo.company || 'Apaar Logistics' },
        office: { name: candidateInfo.office || 'Head Office', address: '' },
      };

      const pdfBuffer = await letterPdfService.generateLetterPDF({
        content: letter.content || '',
        employee: employeeObj,
        title: letter.title,
        type: letter.type,
        signatory: letter.signatory,
      });

      const filename = `${letter.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`Download public offer letter PDF error: ${err.message}`);
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