const crypto = require('crypto');
const { OnboardingInvitation, Employee, Office, Company, Notification, Document, sequelize } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const emailService = require('./email.service');
const uploadService = require('./upload.service');
const authService = require('./auth.service');
const env = require('../config/env');

class OnboardingInvitationService {
  /**
   * Create and send self-onboarding invitation link (Req 2.1)
   */
  async createInvitation(invitationData, issuedBy = null) {
    const { email, candidate_name, phone, designation, department, office_id, company_id, fixed_gross, expiry_days = 7, send_email = true } = invitationData;

    // 1. Check if employee already exists
    const existing = await Employee.findOne({ where: { email } });
    if (existing) {
      if (existing.status === 'resigned') {
        throw new AppError(
          `Candidate with email "${email}" has previously resigned from the organization (ID: ${existing.emp_code}). Please use the Re-Hiring workflow instead of self-onboarding.`,
          409
        );
      }
      throw new AppError('An employee with this email already exists', 409);
    }

    // 2. Check for active pending invitation for this email
    const existingInvite = await OnboardingInvitation.findOne({
      where: { email, status: 'pending' },
    });
    if (existingInvite && new Date(existingInvite.expires_at) > new Date()) {
      // Re-use or refresh token
      existingInvite.expires_at = new Date(Date.now() + (expiry_days * 24 * 60 * 60 * 1000));
      await existingInvite.save();
      
      const link = `${env.APP_URL}/self-onboarding?token=${existingInvite.token}`;
      if (send_email) {
        await this._sendInvitationEmail(email, candidate_name || 'Candidate', link, existingInvite.expires_at);
      }
      return { invitation: existingInvite, link, reissued: true };
    }

    // 3. Generate secure crypto token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (expiry_days * 24 * 60 * 60 * 1000));

    const invitation = await OnboardingInvitation.create({
      token,
      email,
      candidate_name: candidate_name || null,
      phone: phone || null,
      designation: designation || null,
      department: department || null,
      office_id: office_id || null,
      company_id: company_id || null,
      fixed_gross: fixed_gross || 0,
      status: 'pending',
      expires_at: expiresAt,
      created_by: issuedBy,
    });

    const link = `${env.APP_URL}/self-onboarding?token=${token}`;

    let emailSent = false;
    if (send_email) {
      try {
        await this._sendInvitationEmail(email, candidate_name || 'Candidate', link, expiresAt);
        emailSent = true;
      } catch (err) {
        logger.error(`Failed to send self-onboarding email to ${email}: ${err.message}`);
      }
    }

    logger.info(`Onboarding invitation created for ${email} with token ${token.substring(0, 8)}...`);

    return {
      invitation,
      link,
      email_sent: emailSent,
    };
  }

  /**
   * Helper to send invitation email using emailService
   */
  async _sendInvitationEmail(email, name, link, expiresAt) {
    const formattedDate = new Date(expiresAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="background-color: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.05em;">Welcome to the Team!</h2>
          <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Employee Self-Onboarding Portal</p>
        </div>
        <div style="padding: 24px 8px;">
          <p style="font-size: 15px; color: #334155; margin-top: 0;">Dear <strong>${name}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            We are excited to welcome you! To complete your onboarding smoothly, please fill in your personal, banking, and statutory information through our secure employee onboarding portal.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${link}" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Complete Your Onboarding &rarr;
            </a>
          </div>
          <p style="font-size: 12px; color: #64748b; line-height: 1.5;">
            Or copy and paste this link into your browser:<br>
            <a href="${link}" style="color: #2563eb; word-break: break-all;">${link}</a>
          </p>
          <div style="margin-top: 24px; padding: 12px 16px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
            <p style="margin: 0; font-size: 12px; color: #991b1b;">
              <strong>Note:</strong> This link is secure, unique to you, and valid until <strong>${formattedDate}</strong>.
            </p>
          </div>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} Apaar Logistics & Cold Supply Chain Pvt Ltd. All rights reserved.
        </div>
      </div>
    `;

    return emailService.sendMail({
      to: email,
      subject: `Action Required: Complete Your Employee Onboarding — Apaar Logistics`,
      html,
    });
  }

  /**
   * Public validation of invitation token
   */
  async validateToken(token) {
    if (!token) throw new AppError('Invitation token is required', 400);

    const invite = await OnboardingInvitation.findOne({
      where: { token },
      include: [
        { model: Office, as: 'office', attributes: ['id', 'name', 'address'] },
        { model: Company, as: 'company', attributes: ['id', 'name'] },
      ],
    });

    if (!invite) {
      throw new AppError('Invalid or expired onboarding link. Please contact HR.', 404);
    }

    if (invite.status === 'approved') {
      throw new AppError('This onboarding link has already been completed and approved.', 400);
    }

    if (new Date(invite.expires_at) < new Date()) {
      invite.status = 'expired';
      await invite.save();
      throw new AppError('This onboarding link has expired. Please request a new link from HR.', 410);
    }

    return {
      valid: true,
      email: invite.email,
      candidate_name: invite.candidate_name,
      phone: invite.phone,
      designation: invite.designation,
      department: invite.department,
      office: invite.office,
      company: invite.company,
      fixed_gross: invite.fixed_gross,
      status: invite.status,
      expires_at: invite.expires_at,
    };
  }

  /**
   * Candidate self-submits their onboarding details (Req 2.1)
   */
  async submitSelfOnboarding(token, submissionData) {
    const invite = await OnboardingInvitation.findOne({ where: { token } });
    if (!invite) throw new AppError('Invalid invitation link', 404);

    if (new Date(invite.expires_at) < new Date()) {
      invite.status = 'expired';
      await invite.save();
      throw new AppError('This onboarding link has expired', 410);
    }

    if (invite.status === 'approved') {
      throw new AppError('This profile is already approved and active', 400);
    }

    // Process uploaded documents if base64 data_url is provided
    let processedDocs = [];
    if (Array.isArray(submissionData.uploaded_docs)) {
      for (const doc of submissionData.uploaded_docs) {
        let fileUrl = doc.file_url || null;
        let filePath = doc.file_path || null;

        if (doc.data_url && typeof doc.data_url === 'string') {
          try {
            const matches = doc.data_url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');
              let ext = mimeType.split('/')[1] || 'bin';
              if (ext === 'jpeg') ext = 'jpg';
              if (doc.filename && doc.filename.includes('.')) {
                ext = doc.filename.split('.').pop();
              }
              const uploadRes = await uploadService.uploadFile(buffer, {
                folder: `hrms/onboarding/${invite.id}`,
                format: ext,
              });
              fileUrl = uploadRes.public_id;
              filePath = uploadRes.public_id;
            }
          } catch (uploadErr) {
            logger.warn(`Failed to save uploaded doc ${doc.filename}: ${uploadErr.message}`);
          }
        }

        processedDocs.push({
          type: doc.type,
          filename: doc.filename,
          size: doc.size,
          file_url: fileUrl,
          file_path: filePath,
        });
      }
    }

    // Save submitted payload without raw base64 data_url to protect MySQL sort memory
    const cleanSubmissionData = { ...submissionData };
    cleanSubmissionData.uploaded_docs = processedDocs.length > 0 ? processedDocs : (submissionData.uploaded_docs || []);

    invite.submitted_data = {
      ...cleanSubmissionData,
      submitted_at: new Date().toISOString(),
    };
    invite.status = 'submitted';
    if (submissionData.name) invite.candidate_name = submissionData.name;
    if (submissionData.phone) invite.phone = submissionData.phone;
    await invite.save();

    logger.info(`Candidate ${invite.candidate_name || invite.email} submitted self-onboarding details`);

    // Notify Admins & HR
    try {
      const adminUsers = await Employee.findAll({
        where: { role: 'admin', status: 'active' },
        attributes: ['id'],
      });
      for (const admin of adminUsers) {
        await Notification.create({
          employee_id: admin.id,
          title: 'New Self-Onboarding Submission 📋',
          message: `${invite.candidate_name || invite.email} has submitted self-onboarding details for review.`,
          type: 'info',
          category: 'onboarding',
          is_read: false,
        });
      }
    } catch (notifErr) {
      logger.warn(`Could not create admin notifications for self-onboard: ${notifErr.message}`);
    }

    return {
      success: true,
      message: 'Onboarding details submitted successfully. HR will review and activate your account.',
      status: 'submitted',
    };
  }

  /**
   * HR reviews and with 1 click approves candidate into active Employee (Req 2.1)
   * Automatically generates sequential Employee ID (Req 1.2)
   */
  async approveInvitation(invitationId, approvedBy, overrides = {}) {
    const invite = await OnboardingInvitation.findByPk(invitationId);
    if (!invite) throw new AppError('Invitation not found', 404);

    if (invite.status === 'approved') {
      throw new AppError('Invitation already approved', 400);
    }

    const data = invite.submitted_data;
    if (!data) {
      throw new AppError('No submission data found to approve for this invitation', 400);
    }

    // Prepare complete employee registration payload with all overrides and submitted candidate data
    const employeePayload = {
      emp_code: overrides.emp_code || data.emp_code || '',
      name: overrides.name || data.name || invite.candidate_name,
      email: overrides.email || invite.email,
      phone: overrides.phone || data.phone || invite.phone,
      password: data.password || 'Welcome@123',
      date_of_birth: overrides.date_of_birth || data.date_of_birth || null,
      gender: overrides.gender || data.gender || 'male',
      address: overrides.address || data.address || null,
      designation: overrides.designation || data.designation || invite.designation || 'Executive',
      department: overrides.department || data.department || invite.department || 'Operations',
      role: overrides.role || data.role || 'employee',
      date_of_joining: overrides.date_of_joining || data.date_of_joining || new Date().toISOString().split('T')[0],
      office_id: overrides.office_id || data.office_id || invite.office_id,
      company_id: overrides.company_id || data.company_id || invite.company_id,
      fixed_gross: Number(overrides.fixed_gross) || Number(data.fixed_gross) || Number(invite.fixed_gross) || 0,
      payment_mode: overrides.payment_mode || data.payment_mode || 'Bank Transfer',
      bank_name: overrides.bank_name || data.bank_name || null,
      bank_account_number: overrides.bank_account_number || data.bank_account_number || null,
      ifsc_code: overrides.ifsc_code || data.ifsc_code || null,
      pan_number: overrides.pan_number || data.pan_number || null,
      aadhaar_number: overrides.aadhaar_number || data.aadhaar_number || data.aadhaar || null,
      pf_applicable: overrides.pf_applicable !== undefined ? overrides.pf_applicable : (data.pf_applicable !== false),
      pf_ceiling: overrides.pf_ceiling !== undefined ? overrides.pf_ceiling : (data.pf_ceiling || false),
      pf_contribution_mode: overrides.pf_contribution_mode || data.pf_contribution_mode || 'shared',
      pf_employee_rate: overrides.pf_employee_rate !== undefined ? overrides.pf_employee_rate : 0.12,
      pf_employer_rate: overrides.pf_employer_rate !== undefined ? overrides.pf_employer_rate : 0.12,
      esic_applicable: overrides.esic_applicable !== undefined ? overrides.esic_applicable : (data.esic_applicable || false),
      esic_contribution_mode: overrides.esic_contribution_mode || data.esic_contribution_mode || 'shared',
      esic_employee_rate: overrides.esic_employee_rate !== undefined ? overrides.esic_employee_rate : 0.0075,
      esic_employer_rate: overrides.esic_employer_rate !== undefined ? overrides.esic_employer_rate : 0.0325,
      pt_applicable: overrides.pt_applicable !== undefined ? overrides.pt_applicable : true,
      pf_number: overrides.pf_number || data.pf_number || null,
      uan: overrides.uan || data.uan || null,
      lic_details: overrides.lic_details || data.lic_details || null,
      emergency_contact_name: overrides.emergency_contact_name || data.emergency_contact_name || null,
      emergency_contact_relation: overrides.emergency_contact_relation || data.emergency_contact_relation || null,
      emergency_contact_phone: overrides.emergency_contact_phone || data.emergency_phone || data.emergency_contact_phone || null,
      shift_start_time: overrides.shift_start_time || data.shift_start_time || '10:00:00',
      shift_end_time: overrides.shift_end_time || data.shift_end_time || '19:00:00',
      half_day_late_minutes: overrides.half_day_late_minutes ?? (data.half_day_late_minutes ?? 60),
      send_offer_letter: overrides.send_offer_letter === true,
    };

    // Register employee using standard pipeline
    const newEmployee = await authService.register(employeePayload, approvedBy);

    // Save submitted candidate documents into documents table
    if (Array.isArray(data.uploaded_docs) && data.uploaded_docs.length > 0) {
      for (const doc of data.uploaded_docs) {
        try {
          const typeMapping = {
            aadhaar_card: 'id_proof',
            pan_card: 'id_proof',
            bank_proof: 'other',
            photo: 'other',
          };
          await Document.create({
            employee_id: newEmployee.id,
            name: doc.filename || `${doc.type || 'Document'}.pdf`,
            type: typeMapping[doc.type] || 'id_proof',
            file_path: doc.file_path || `uploads/${doc.filename || doc.type}`,
            file_size: doc.size || 102400,
            mime_type: doc.mime_type || 'image/jpeg',
            status: 'verified',
            verified_by: approvedBy,
            verified_at: new Date(),
          });
        } catch (docErr) {
          logger.warn(`Could not save document ${doc.filename} for new employee ${newEmployee.id}: ${docErr.message}`);
        }
      }
    }

    // Update invitation status
    invite.status = 'approved';
    invite.approved_by = approvedBy;
    invite.approved_at = new Date();
    await invite.save();

    logger.info(`Onboarding invitation ID ${invitationId} approved by Admin ${approvedBy}. Employee code assigned: ${newEmployee.emp_code}`);

    return {
      success: true,
      employee: newEmployee,
      invitation_id: invite.id,
    };
  }

  /**
   * Reject / revoke an invitation
   */
  async rejectInvitation(invitationId, reason, rejectedBy) {
    const invite = await OnboardingInvitation.findByPk(invitationId);
    if (!invite) throw new AppError('Invitation not found', 404);

    invite.status = 'rejected';
    invite.rejection_reason = reason || 'Rejected by HR';
    await invite.save();

    logger.info(`Invitation ${invitationId} rejected by ${rejectedBy}: ${reason}`);
    return invite;
  }

  /**
   * List all invitations for Admin / HR review
   */
  async getAllInvitations({ status, search, page = 1, limit = 20 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (search) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { email: { [Op.like]: `%${search}%` } },
        { candidate_name: { [Op.like]: `%${search}%` } },
        { designation: { [Op.like]: `%${search}%` } },
      ];
    }

    const offset = (page - 1) * limit;
    const { rows, count } = await OnboardingInvitation.findAndCountAll({
      where,
      include: [
        { model: Office, as: 'office', attributes: ['id', 'name'] },
        { model: Company, as: 'company', attributes: ['id', 'name'] },
        { model: Employee, as: 'creator', attributes: ['id', 'name', 'emp_code'] },
        { model: Employee, as: 'approver', attributes: ['id', 'name', 'emp_code'] },
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }
}

module.exports = new OnboardingInvitationService();
