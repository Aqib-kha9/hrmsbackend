const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Email service — nodemailer wrapper with Brevo (Sendinblue) SMTP.
 *
 * Sends offer letters, welcome emails, and any system notifications.
 * Uses a pooled transporter for efficiency.
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this._initTransporter();
  }

  _initTransporter() {
    if (!env.SMTP_HOST || !env.SMTP_USER) {
      logger.warn('SMTP not configured — emails will be logged instead of sent');
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      connectionTimeout: 5000, // 5 seconds connection timeout
      greetingTimeout: 5000,   // 5 seconds greeting timeout
      socketTimeout: 10000,    // 10 seconds socket timeout
    });

    // Verify connection on startup (non-blocking)
    this.transporter.verify((err) => {
      if (err) {
        logger.error('SMTP connection verification failed:', err.message);
      } else {
        logger.info('SMTP connection verified — email service ready');
      }
    });
  }

  /**
   * Send an email.
   * If SMTP is not configured, logs the email content instead.
   *
   * @param {object} options
   * @param {string} options.to - Recipient email address
   * @param {string} options.subject - Email subject line
   * @param {string} options.html - HTML body content
   * @param {Array<{filename: string, content: Buffer}>} [options.attachments] - Optional attachments
   * @returns {Promise<{accepted: string[], messageId: string}>}
   */
  async sendMail({ to, subject, html, attachments }) {
    if (!this.transporter) {
      logger.info(`[EMAIL DRY-RUN] To: ${to} | Subject: ${subject}`);
      if (attachments && attachments.length > 0) {
        logger.info(`[EMAIL DRY-RUN] Attachments: ${attachments.map(a => a.filename).join(', ')}`);
      }
      return { accepted: [to], messageId: 'dry-run' };
    }

    try {
      const result = await this.transporter.sendMail({
        from: env.SMTP_FROM || env.SMTP_USER,
        to,
        subject,
        html,
        attachments,
      });
      logger.info(`Email sent to ${to} — ${subject} — ${result.messageId}`);
      return { accepted: result.accepted, messageId: result.messageId };
    } catch (error) {
      logger.error(`Email failed to ${to}:`, error.message);
      throw error;
    }
  }

  /**
   * Send welcome email with credentials and offer letter PDF.
   *
   * @param {object} employee - Employee record with { name, email, emp_code, designation }
   * @param {string} password - Plain-text password for first login
   * @param {Buffer} offerLetterPDF - Generated PDF buffer (optional)
   * @returns {Promise<void>}
   */
  async sendWelcomeEmail(employee, password, offerLetterPDF) {
    const companyName = 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
    const subject = `Welcome to ${companyName} — Offer Letter & Credentials`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background: #1a237e; color: #fff; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 22px;">${companyName}</h1>
    <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">Offer Letter & Onboarding</p>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px;">Dear <strong>${employee.name}</strong>,</p>
    <p>Congratulations! We are pleased to welcome you to <strong>${companyName}</strong>.</p>
    <p>Your offer letter is attached to this email. Below are your login credentials for the HRMS portal:</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
      <tr><td style="padding: 8px; background: #f5f5f5; width: 140px;"><strong>Employee Code</strong></td><td style="padding: 8px;">${employee.emp_code}</td></tr>
      <tr><td style="padding: 8px; background: #f5f5f5;"><strong>Designation</strong></td><td style="padding: 8px;">${employee.designation || '-'}</td></tr>
      <tr><td style="padding: 8px; background: #f5f5f5;"><strong>Email</strong></td><td style="padding: 8px;">${employee.email}</td></tr>
      <tr><td style="padding: 8px; background: #f5f5f5;"><strong>Password</strong></td><td style="padding: 8px;">${password}</td></tr>
    </table>

    <p style="font-size: 13px; color: #d32f2f; background: #fbe9e7; padding: 12px; border-radius: 4px;">
      ⚠️ Please change your password after your first login for security purposes.
    </p>

    <p>Please acknowledge your offer letter through the HRMS portal at your earliest convenience.</p>

    <p style="margin-top: 24px;">
      Best regards,<br>
      <strong>HR Department</strong><br>
      ${companyName}
    </p>
  </div>
</body>
</html>`;

    const attachments = [];
    if (offerLetterPDF && offerLetterPDF.length > 0) {
      attachments.push({
        filename: `Offer_Letter_${employee.emp_code}.pdf`,
        content: offerLetterPDF,
        contentType: 'application/pdf',
      });
    }

    const result = await this.sendMail({
      to: employee.email,
      subject,
      html,
      attachments,
    });

    logger.info(`Welcome email sent to ${employee.email} for emp_code ${employee.emp_code}`);
    return result;
  }

  /**
   * Send password reset email with a reset link containing the raw token.
   * The link points to the mobile app via deep link or the web portal.
   *
   * @param {object} employee - { name, email, emp_code }
   * @param {string} rawToken - The plain-text reset token (NOT the hashed version)
   */
  async sendPasswordResetEmail(employee, rawToken) {
    const companyName = 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
    const subject = `Password Reset Request — ${companyName}`;

    // Reset URL — opens the web reset page (email clients open this in browser)
    const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background: #1a237e; color: #fff; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 22px;">${companyName}</h1>
    <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">Password Reset</p>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px;">Dear <strong>${employee.name}</strong>,</p>
    <p>We received a request to reset the password for your HRMS account (Employee Code: <strong>${employee.emp_code}</strong>).</p>
    <p>Click the button below to reset your password. This link will expire in <strong>1 hour</strong>.</p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: #1a237e; color: #fff; padding: 14px 36px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
        Reset Your Password
      </a>
    </div>

    <p style="font-size: 12px; color: #777; margin: 20px 0;">
      If the button above doesn't work, copy and paste this link into your browser:<br>
      <a href="${resetUrl}" style="color: #1a237e; word-break: break-all;">${resetUrl}</a>
    </p>

    <p style="font-size: 13px; color: #d32f2f; background: #fbe9e7; padding: 12px; border-radius: 4px;">
      ⚠️ If you did not request this password reset, please ignore this email or contact HR immediately. Your account security has not been compromised.
    </p>

    <p style="margin-top: 24px;">
      Best regards,<br>
      <strong>HR Department</strong><br>
      ${companyName}
    </p>
  </div>
</body>
</html>`;

    const result = await this.sendMail({
      to: employee.email,
      subject,
      html,
    });

    logger.info(`Password reset email sent to ${employee.email} for emp_code ${employee.emp_code}`);
    return result;
  }

  /**
   * Send official employee letter email with PDF attachment.
   * Supports Offer Letter, Relieving Letter, Appointment Letter, Form 16, etc. (Req 2.10)
   *
   * @param {object} params
   * @param {string} params.to - Recipient registered email address
   * @param {string} params.employeeName - Recipient full name
   * @param {string} [params.empCode] - Employee code (or candidate)
   * @param {string} params.letterTitle - Official letter title (e.g. Appointment Letter)
   * @param {string} params.letterType - Type code (offer, appointment, relieving, form16, etc.)
   * @param {string} [params.companyName] - Issuing company name
   * @param {Buffer} params.pdfBuffer - Generated PDF attachment buffer
   * @param {string} [params.customSubject] - Optional subject override
   * @param {string} [params.customNote] - Optional notes from HR
   */
  async sendOfficialLetterEmail({ to, employeeName, empCode = '', letterTitle, letterType, companyName = 'Apaar Logistics & Cold Supply Chain Pvt Ltd', pdfBuffer, customSubject, customNote }) {
    const subject = customSubject || `${letterTitle} — ${companyName}`;

    let letterDescription = '';
    let actionInstructions = '';

    switch (letterType) {
      case 'offer':
        letterDescription = 'We are pleased to share your official Offer of Employment.';
        actionInstructions = 'Please review the offered compensation details and joining terms. Kindly confirm your acceptance by replying to this email or acknowledging the offer in the HRMS portal.';
        break;
      case 'appointment':
        letterDescription = 'We are pleased to issue your formal Appointment Letter confirming your employment.';
        actionInstructions = 'Please review your appointment terms and detailed salary breakdown (Annexure A). You are requested to sign and return a copy for your employee records.';
        break;
      case 'relieving':
        letterDescription = 'This letter formally confirms that you have been relieved from your duties.';
        actionInstructions = 'All department clearances and handover formalities have been recorded. Full and final settlement details will follow as per company exit policy.';
        break;
      case 'form16':
        letterDescription = 'Please find attached your Form 16 (Certificate under Section 203 of the Income-tax Act, 1961 for Tax Deducted at Source on Salary).';
        actionInstructions = 'This document certifies the tax deducted and deposited into the Central Government account for the financial year. You may retain this certificate for filing your annual Income Tax Return (ITR).';
        break;
      default:
        letterDescription = `Please find attached your official ${letterTitle}.`;
        actionInstructions = 'Please keep this document safely for your official employment records.';
    }

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: 0 auto; background-color: #f8fafc; padding: 20px;">
  <div style="background: #0f172a; color: #ffffff; padding: 24px 28px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">${companyName}</h1>
    <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Human Resources Department</p>
  </div>
  <div style="padding: 28px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <p style="font-size: 15px; margin-top: 0;">Dear <strong>${employeeName}</strong>,</p>
    
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      ${letterDescription}
    </p>

    <div style="background: #f1f5f9; border-left: 4px solid #0f172a; padding: 14px 18px; margin: 18px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; font-size: 13px; font-weight: 700; color: #0f172a;">Document: ${letterTitle}</p>
      ${empCode ? `<p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Employee Code: ${empCode}</p>` : ''}
      <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Date of Issue: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
    </div>

    ${customNote ? `
      <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 12px 16px; margin: 16px 0; border-radius: 6px; font-size: 13px; color: #92400e;">
        <strong>Note from HR:</strong> ${customNote}
      </div>
    ` : ''}

    <p style="font-size: 13.5px; line-height: 1.6; color: #475569;">
      ${actionInstructions}
    </p>

    <p style="font-size: 13px; color: #64748b; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
      The complete, officially signed document is attached to this email in PDF format.<br/>
      If you have any questions or require clarifications, please contact the HR team.
    </p>

    <div style="margin-top: 24px; padding-top: 12px;">
      <p style="margin: 0; font-size: 13px; font-weight: 700; color: #1e293b;">Warm regards,</p>
      <p style="margin: 2px 0 0; font-size: 13px; font-weight: 600; color: #0f172a;">HR Operations Team</p>
      <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">${companyName}</p>
    </div>
  </div>
</body>
</html>`;

    const attachments = [];
    if (pdfBuffer && pdfBuffer.length > 0) {
      const sanitizedCode = empCode ? empCode.replace(/[^a-zA-Z0-9_-]/g, '') : 'document';
      attachments.push({
        filename: `${letterType}_${sanitizedCode}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    }

    const result = await this.sendMail({
      to,
      subject,
      html,
      attachments,
    });

    logger.info(`Official ${letterType} letter email dispatched to registered email ${to} (emp: ${empCode || 'candidate'})`);
    return result;
  }
}

// Singleton
module.exports = new EmailService();