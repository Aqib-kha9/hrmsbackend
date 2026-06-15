    const PDFDocument = require('pdfkit');
const { amountToWords, salaryToWords } = require('../utils/amount-to-words');
const { Letter } = require('../models');
const emailService = require('./email.service');
const logger = require('../utils/logger');

/**
 * Offer letter PDF generation & delivery service.
 *
 * Generates a professionally formatted offer letter as PDF using pdfkit,
 * creates a Letter record in the database, and emails it to the employee.
 *
 * Layout follows real-world payslip data from "Apaar Logistics & Cold Supply Chain Pvt Ltd".
 */
class OfferLetterService {
  COMPANY_NAME = 'Apaar Logistics & Cold Supply Chain Pvt Ltd';
  COMPANY_SHORT = 'APAAR LOGISTICS';
  COMPANY_ADDRESS = 'Corporate Office, [Your Company Address]';

  /**
   * Calculate salary components from gross using the 40% basic formula.
   * Mirrors payroll_ledger.service.js _calculateRow() logic.
   *
   * @param {number} fixedGross
   * @returns {{ basic: number, hra: number, otherAllowance: number }}
   */
  _calculateBreakup(fixedGross) {
    const basic = Math.round(fixedGross * 0.40);
    const hra = Math.round(basic * 0.40);
    const otherAllowance = fixedGross - basic - hra;
    return { basic, hra, otherAllowance };
  }

  /**
   * Calculate CTC from salary structure.
   *
   * CTC = Gross + PF Employer + ESIC Employer
   *
   * @param {number} gross
   * @param {number} basic
   * @param {boolean} pfApplicable
   * @param {boolean} pfCeiling
   * @param {boolean} esicApplicable
   * @returns {{ ctc: number, pfEmployer: number, esiEmployer: number }}
   */
  _calculateCTC(gross, basic, pfApplicable, pfCeiling, esicApplicable, {
    pfContributionMode = 'shared',
    esicContributionMode = 'shared',
    pfEmployerRate = 0.12,
    esicEmployerRate = 0.0325,
  } = {}) {
    // ── PF employer contribution (Phase 8: respect modes) ──
    let pfEmployer = 0;
    if (pfApplicable) {
      const pfBase = pfCeiling ? Math.min(basic, 15000) : basic;
      switch (pfContributionMode) {
        case 'employer_only':
        case 'shared':
          pfEmployer = Math.round(pfBase * pfEmployerRate);
          break;
        case 'employee_only':
        case 'none':
        default:
          pfEmployer = 0;
          break;
      }
    }

    // ── ESIC employer contribution (Phase 8: respect modes) ──
    const esiEmployer = esicApplicable && esicContributionMode === 'shared'
      ? Math.ceil(gross * esicEmployerRate)
      : 0;

    const ctc = gross + pfEmployer + esiEmployer;
    return { ctc, pfEmployer, esiEmployer };
  }

  /**
   * Generate a professional offer letter PDF.
   *
   * @param {object} employee - Employee record with all fields
   * @param {object} salaryStructure - SalaryStructure record
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateOfferLetterPDF(employee, salaryStructure) {
    const gross = Number(salaryStructure.fixed_gross) || Number(employee.fixed_gross) || 0;
    const { basic, hra, otherAllowance } = this._calculateBreakup(gross);
    const specialAllowance = Number(salaryStructure.special_allowance) || 0;
    const conveyance = Number(salaryStructure.conveyance) || 0;
    const medicalAllowance = Number(salaryStructure.medical_allowance) || 0;
    const effectiveWorkDays = salaryStructure.effective_work_days || 26;

    const { ctc, pfEmployer, esiEmployer } = this._calculateCTC(
      gross, basic,
      salaryStructure.pf_applicable !== false,
      salaryStructure.pf_ceiling || false,
      salaryStructure.esic_applicable || false,
      {
        pfContributionMode: salaryStructure.pf_contribution_mode || employee.pf_contribution_mode || 'shared',
        esicContributionMode: salaryStructure.esic_contribution_mode || employee.esic_contribution_mode || 'shared',
        pfEmployerRate: Number(salaryStructure.pf_employer_rate ?? 0.12),
        esicEmployerRate: Number(salaryStructure.esic_employer_rate ?? 0.0325),
      },
    );

    const grossWords = salaryToWords(gross);
    const dateOfJoining = employee.date_of_joining
      ? new Date(employee.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
      : '_______________';
    const issuedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    return new Promise((resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
      });

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──
      doc.fontSize(16).font('Helvetica-Bold').text(this.COMPANY_SHORT, { align: 'center' });
      doc.fontSize(9).font('Helvetica').text(this.COMPANY_NAME, { align: 'center' });
      doc.fontSize(8).text(this.COMPANY_ADDRESS, { align: 'center' });
      doc.moveDown(0.25);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#1a237e').lineWidth(1.2).stroke();
      doc.moveDown(0.25);

      // ── Title ──
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a237e').text('OFFER LETTER', { align: 'center' });
      doc.fillColor('#333');
      doc.moveDown(0.3);

      // ── Date & Ref ──
      doc.fontSize(9).font('Helvetica');
      doc.text(`Date: ${issuedDate}`, { align: 'right' });
      doc.text(`Ref: APAAR/HR/OL/${employee.emp_code}/${new Date().getFullYear()}`, { align: 'right' });
      doc.moveDown(0.3);

      // ── Employee Info ──
      doc.fontSize(10).font('Helvetica-Bold').text('To,');
      doc.fontSize(10).text(employee.name);
      if (employee.address) doc.fontSize(9).text(employee.address);
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').text(`Subject: Offer of Employment for the position of ${employee.designation || '_______________'}`);
      doc.moveDown(0.25);

      // ── Body ──
      doc.fontSize(10).font('Helvetica');
      doc.text(`Dear ${employee.name},`, { lineGap: 2 });
      doc.moveDown(0.15);

      doc.text(
        `We are pleased to offer you the position of "${employee.designation || '_______________'}" ` +
        `at ${this.COMPANY_NAME}. We were impressed by your qualifications and believe ` +
        `that your skills and experience will be a valuable addition to our team.`,
        { lineGap: 4, align: 'justify' },
      );
      doc.moveDown(0.25);

      doc.text('The terms and conditions of your employment are as follows:', { lineGap: 2 });
      doc.moveDown(0.25);

      // ── 1. Date of Joining ──
      doc.font('Helvetica-Bold').text('1. Date of Joining:');
      doc.font('Helvetica').text(`   ${dateOfJoining}`);
      doc.moveDown(0.15);

      // ── 2. Location ──
      doc.font('Helvetica-Bold').text('2. Place of Posting:');
      doc.font('Helvetica').text(`   ${employee.location || this.COMPANY_ADDRESS}`);
      doc.moveDown(0.15);

      // ── 3. Compensation ──
      doc.font('Helvetica-Bold').text('3. Compensation Package (Per Month):');
      doc.moveDown(0.15);

      // Salary table
      const tableStartY = doc.y;
      const col1 = 60;
      const col2 = 250;
      const col3 = 400;
      const rowH = 20;

      const drawTableHeader = (y) => {
        doc.rect(50, y, 495, rowH).fill('#1a237e');
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
        doc.text('Component', col1, y + 5, { width: col2 - col1 - 10 });
        doc.text('Monthly (₹)', col3, y + 5, { width: 100, align: 'right' });
        doc.fillColor('#333');
      };

      const drawTableRow = (y, label, value, highlight) => {
        if (highlight) {
          doc.rect(50, y, 495, rowH).fill('#e8eaf6');
          doc.fillColor('#333');
        }
        doc.fontSize(9).font('Helvetica');
        doc.text(label, col1, y + 5, { width: col2 - col1 - 10 });
        doc.text(value.toLocaleString('en-IN'), col3, y + 5, { width: 100, align: 'right' });
        doc.fillColor('#333');
        return y + rowH;
      };

      let y = tableStartY;
      drawTableHeader(y); y += rowH;
      y = drawTableRow(y, 'Basic Salary', basic, false);
      y = drawTableRow(y, 'House Rent Allowance (HRA)', hra, false);
      if (specialAllowance > 0) y = drawTableRow(y, 'Special Allowance', specialAllowance, false);
      y = drawTableRow(y, 'Other Allowance', otherAllowance, false);
      if (conveyance > 0) y = drawTableRow(y, 'Conveyance Allowance', conveyance, false);
      if (medicalAllowance > 0) y = drawTableRow(y, 'Medical Allowance', medicalAllowance, false);
      y = drawTableRow(y, 'Gross Salary', gross, true);

      // Reset cursor after explicit-coordinate table drawing
      doc.x = doc.page.margins.left;
      doc.y = y;

      doc.moveDown(0.4);

      // Gross in words
      doc.fontSize(10).font('Helvetica');
      doc.text(`Gross Salary in Words: ${grossWords}`, { indent: 10 });
      doc.moveDown(0.25);

      // ── 4. Statutory Contributions ──
      doc.fontSize(10).font('Helvetica-Bold').text('4. Statutory Contributions & CTC:');
      doc.fontSize(10).font('Helvetica');
      doc.text(`   • PF: ${employee.pf_applicable !== false ? 'Applicable (12% of Basic)' : 'Not Applicable'}${employee.pf_ceiling ? ' (ceiling ₹15,000)' : ''}`);
      doc.text(`   • ESIC: ${employee.esic_applicable ? 'Applicable' : 'Not Applicable'}  • Professional Tax: As per state slab`);
      doc.moveDown(0.15);
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`   Monthly CTC: ₹ ${ctc.toLocaleString('en-IN')} (${salaryToWords(ctc)})`);

      doc.moveDown(0.25);

      // ── 5. Working Days ──
      doc.fontSize(10).font('Helvetica-Bold').text('5. Working Days:');
      doc.fontSize(10).font('Helvetica').text(`   ${effectiveWorkDays} working days per month. Loss of Pay (LOP) calculated proportionally.`);
      doc.moveDown(0.15);

      // ── 6. Probation ──
      doc.fontSize(10).font('Helvetica-Bold').text('6. Probation Period:');
      doc.fontSize(10).font('Helvetica').text('   6 months from date of joining. Upon successful completion, employment will be confirmed in writing.');
      doc.moveDown(0.15);

      // ── 7. Leave ──
      doc.fontSize(10).font('Helvetica-Bold').text('7. Leave Entitlement:');
      doc.fontSize(10).font('Helvetica').text('   As per company policy. Details available on the HRMS portal after onboarding.');
      doc.moveDown(0.15);

      // ── 8. Notice Period ──
      doc.fontSize(10).font('Helvetica-Bold').text('8. Notice Period:');
      doc.fontSize(10).font('Helvetica').text('   During probation: 15 days. After confirmation: 30 days or salary in lieu thereof.');
      doc.moveDown(0.25);

      // ── Acceptance note ──
      doc.fontSize(10).font('Helvetica');
      doc.text('Please confirm your acceptance by signing and returning a copy, and acknowledging through the HRMS portal.', { lineGap: 3, align: 'justify' });
      doc.moveDown(0.2);
      doc.text('We look forward to a long and mutually beneficial association. Welcome aboard!');
      doc.moveDown(0.6);

      // ── Signature ──
      doc.fontSize(10).font('Helvetica-Bold').text('For ' + this.COMPANY_NAME);
      doc.moveDown(1);
      doc.fontSize(10).text('_______________________________');
      doc.fontSize(9).font('Helvetica').text('(Authorized Signatory)');
      doc.moveDown(0.2);
      doc.fontSize(10).text('Date: _______________    Place: _______________');

      doc.moveDown(0.8);

      // ── Acceptance Section ──
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#1a237e').lineWidth(0.5).stroke();
      doc.moveDown(0.25);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a237e').text('ACCEPTANCE', { align: 'center' });
      doc.fillColor('#333');
      doc.moveDown(0.25);

      doc.fontSize(10).font('Helvetica');
      doc.text('I, _______________________________, hereby accept the above terms and conditions of employment.');
      doc.moveDown(0.5);
      doc.text('Signature: _______________    Date: _______________    Place: _______________');
      doc.moveDown(0.5);

      // ── Footer ──
      doc.fontSize(8).font('Helvetica').fillColor('#888');
      doc.text(`This is a computer-generated document. | ${this.COMPANY_NAME} | Generated on ${issuedDate}`, { align: 'center' });

      doc.end();
    });
  }

  /**
   * Full onboarding workflow: Generate offer letter PDF → Save Letter record → Send email.
   *
   * @param {object} employee - Employee record (after creation)
   * @param {object} salaryStructure - SalaryStructure record
   * @param {string} plainPassword - Plain-text password for the welcome email
   * @param {number} issuedBy - Admin employee ID who initiated the onboarding
   * @returns {Promise<{letter: object, emailResult: object}>}
   */
  async issueAndSendOfferLetter(employee, salaryStructure, plainPassword, issuedBy) {
    // 1. Generate PDF
    const pdfBuffer = await this.generateOfferLetterPDF(employee, salaryStructure);

    // 2. Create Letter record in database
    const letter = await Letter.create({
      employee_id: employee.id,
      type: 'offer',
      title: `Offer Letter — ${employee.designation || 'Employment'}`,
      content: `Offer letter issued for the position of ${employee.designation || 'N/A'} with gross salary of ₹${Number(salaryStructure.fixed_gross).toLocaleString('en-IN')}.`,
      issued_date: new Date(),
      issued_by: issuedBy,
      status: 'issued',
    });

    logger.info(`Offer letter record created: letter_id=${letter.id} for employee ${employee.emp_code}`);

    // 3. Send email with PDF attachment (fire-and-forget — don't block the response)
    //    Render free tier blocks outbound SMTP, so email may fail but the employee
    //    is already fully created and the letter is saved.
    let emailResult = { accepted: [], messageId: 'fire-and-forget' };
    emailService
      .sendWelcomeEmail(employee, plainPassword, pdfBuffer)
      .then((result) => {
        logger.info(`Welcome email sent to ${employee.email} — ${result.messageId}`);
      })
      .catch((err) => {
        logger.error(`Welcome email failed for ${employee.email}: ${err.message}`);
      });

    return { letter, emailResult };
  }
}

module.exports = new OfferLetterService();