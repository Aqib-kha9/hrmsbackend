const PDFDocument = require('pdfkit');

/**
 * Helper to convert numbers to Indian currency words
 */
function numberToWords(num) {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n) {
    if ((n = n.toString()).length > 9) return 'overflow';
    const n_match = ('000000000' + n).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n_match) return '';
    let str = '';
    str += (Number(n_match[1]) !== 0) ? (a[Number(n_match[1])] || b[n_match[1][0]] + ' ' + a[n_match[1][1]]) + 'Crore ' : '';
    str += (Number(n_match[2]) !== 0) ? (a[Number(n_match[2])] || b[n_match[2][0]] + ' ' + a[n_match[2][1]]) + 'Lakh ' : '';
    str += (Number(n_match[3]) !== 0) ? (a[Number(n_match[3])] || b[n_match[3][0]] + ' ' + a[n_match[3][1]]) + 'Thousand ' : '';
    str += (Number(n_match[4]) !== 0) ? (a[Number(n_match[4])] || b[n_match[4][0]] + ' ' + a[n_match[4][1]]) + 'Hundred ' : '';
    str += (Number(n_match[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n_match[5])] || b[n_match[5][0]] + ' ' + a[n_match[5][1]]) : '';
    return str.trim();
  }

  const rounded = Math.round(Number(num) || 0);
  if (rounded === 0) return 'Zero Rupees Only';
  return `${inWords(rounded)} Rupees Only`;
}

class PayslipPdfService {
  /**
   * Generates a modern, clean, revised salary slip PDF buffer (Req 3.1, 3.2, 3.3).
   * @param {Object} payslipData - Full salary slip information
   */
  async generatePayslipPDF(payslipData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 36,
          info: {
            Title: `Salary Slip - ${payslipData.employee_name || 'Employee'} - ${payslipData.month || ''} ${payslipData.year || ''}`,
            Author: payslipData.company_name || 'HRMS',
          },
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const formatCurr = (val) => `Rs. ${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Colors
        const primaryColor = '#0f172a'; // slate-900
        const accentColor = '#2563eb';  // blue-600
        const textColor = '#1e293b';    // slate-800
        const mutedColor = '#64748b';   // slate-500
        const borderColor = '#cbd5e1'; // slate-300
        const lightBg = '#f8fafc';     // slate-50

        // ── Top Header Bar ──
        doc.rect(36, 36, 523, 6).fill(accentColor);

        // Company Title & Month
        doc.fillColor(primaryColor)
           .fontSize(16)
           .font('Helvetica-Bold')
           .text(payslipData.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd', 36, 52, { align: 'center', width: 523 });

        doc.fillColor(mutedColor)
           .fontSize(9)
           .font('Helvetica')
           .text(payslipData.office_address || payslipData.location || 'Corporate Office, India', 36, 72, { align: 'center', width: 523 });

        const cycleTitle = `SALARY SLIP FOR THE MONTH OF ${String(payslipData.month || '').toUpperCase()} ${payslipData.year || ''}`;
        doc.rect(36, 88, 523, 24).fill(lightBg);
        doc.rect(36, 88, 523, 24).stroke(borderColor);
        doc.fillColor(primaryColor)
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(cycleTitle, 36, 95, { align: 'center', width: 523 });

        // ── Employee Profile Info Grid ──
        let y = 120;
        const col1 = 45;
        const col2 = 220;
        const col3 = 390;

        doc.fontSize(8);

        const printField = (label, val, xPos, yPos) => {
          doc.font('Helvetica-Bold').fillColor(mutedColor).text(label, xPos, yPos);
          doc.font('Helvetica-Bold').fillColor(textColor).text(val || '--', xPos + 68, yPos);
        };

        printField('Name:', payslipData.employee_name, col1, y);
        printField('Emp ID:', payslipData.emp_code, col2, y);
        printField('UAN:', payslipData.uan, col3, y);

        y += 15;
        printField('Designation:', payslipData.designation, col1, y);
        printField('Department:', payslipData.department, col2, y);
        printField('PF No:', payslipData.pf_number, col3, y);

        y += 15;
        printField('Bank Name:', payslipData.bank_name, col1, y);
        printField('A/C No:', payslipData.bank_account_number, col2, y);
        printField('PAN:', payslipData.pan_number, col3, y);

        y += 20;

        // ── Attendance Information Section (Req 3.2) ──
        doc.rect(36, y, 523, 30).fill('#f1f5f9');
        doc.rect(36, y, 523, 30).stroke(borderColor);

        const musterDays = payslipData.total_muster_days || payslipData.working_days || 30;
        const presentDays = payslipData.present_days !== undefined ? payslipData.present_days : (payslipData.paid_days || musterDays);
        const payableDays = payslipData.payable_days !== undefined ? payslipData.payable_days : (payslipData.paid_days || musterDays);
        const lwpDays = payslipData.lwp_days !== undefined ? payslipData.lwp_days : (payslipData.lop_days || Math.max(0, musterDays - payableDays));

        const attColWidth = 523 / 4;
        const drawAttCard = (title, val, index, valColor = textColor) => {
          const x = 36 + (index * attColWidth);
          doc.font('Helvetica').fontSize(8).fillColor(mutedColor).text(title, x, y + 5, { width: attColWidth, align: 'center' });
          doc.font('Helvetica-Bold').fontSize(11).fillColor(valColor).text(String(val), x, y + 16, { width: attColWidth, align: 'center' });
        };

        drawAttCard('Total / Muster Days', musterDays, 0);
        drawAttCard('Present / Working Days', presentDays, 1);
        drawAttCard('Payable Days', payableDays, 2, '#059669'); // emerald
        drawAttCard('LWP / Leave Without Pay', lwpDays, 3, lwpDays > 0 ? '#dc2626' : textColor); // rose

        y += 40;

        // ── Earnings & Deductions Table (Req 3.3) ──
        const tableTop = y;
        const tableWidth = 523;
        const halfWidth = tableWidth / 2;
        const hasStandard = Boolean(payslipData.fixed_gross && Number(payslipData.fixed_gross) > 0);

        // Table Header
        doc.rect(36, tableTop, halfWidth, 20).fill('#e2e8f0');
        doc.rect(36, tableTop, halfWidth, 20).stroke(borderColor);
        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5);

        if (hasStandard) {
          doc.text('EARNINGS', 44, tableTop + 6);
          doc.text('STANDARD', 145, tableTop + 6, { align: 'right', width: 65 });
          doc.text('EARNED (INR)', 215, tableTop + 6, { align: 'right', width: 75 });
        } else {
          doc.text('EARNINGS', 46, tableTop + 6);
          doc.text('EARNED AMOUNT (INR)', 36 + halfWidth - 120, tableTop + 6, { align: 'right', width: 110 });
        }

        doc.rect(36 + halfWidth, tableTop, halfWidth, 20).fill('#e2e8f0');
        doc.rect(36 + halfWidth, tableTop, halfWidth, 20).stroke(borderColor);
        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('DEDUCTIONS', 36 + halfWidth + 10, tableTop + 6);
        doc.text('AMOUNT (INR)', 36 + tableWidth - 95, tableTop + 6, { align: 'right', width: 85 });

        // Items
        const fixedGross = Number(payslipData.fixed_gross) || 0;
        const fixedBasic = payslipData.fixed_basic || (hasStandard ? Math.round(fixedGross * 0.40) : null);
        const fixedHra = payslipData.fixed_hra || (hasStandard ? Math.round(fixedBasic * 0.40) : null);
        const fixedOther = payslipData.fixed_other || (hasStandard ? (fixedGross - fixedBasic - fixedHra) : null);

        const earnings = [
          { name: 'Basic Salary', standard: fixedBasic, amount: payslipData.basic_salary || 0 },
          { name: 'House Rent Allowance (HRA)', standard: fixedHra, amount: payslipData.hra || 0 },
          { name: 'Special / Other Allowance', standard: fixedOther, amount: payslipData.other_allowance || payslipData.special_allowance || 0 },
        ];
        if (payslipData.conveyance > 0) earnings.push({ name: 'Conveyance Allowance', standard: null, amount: payslipData.conveyance });
        if (payslipData.medical_allowance > 0) earnings.push({ name: 'Medical Allowance', standard: null, amount: payslipData.medical_allowance });
        if (payslipData.bonus > 0) earnings.push({ name: 'Performance Bonus', standard: null, amount: payslipData.bonus });
        if (payslipData.incentive > 0) earnings.push({ name: 'Incentive', standard: null, amount: payslipData.incentive });
        if (payslipData.previous_arrears > 0) earnings.push({ name: 'Arrears', standard: null, amount: payslipData.previous_arrears });

        const deductions = [];
        if (payslipData.pf_employee > 0) deductions.push({ name: 'Provident Fund (PF - Employee)', amount: payslipData.pf_employee });
        if (payslipData.esi_employee > 0) deductions.push({ name: 'ESIC (Employee Contribution)', amount: payslipData.esi_employee });
        if (payslipData.professional_tax > 0) deductions.push({ name: 'Professional Tax (PT)', amount: payslipData.professional_tax });
        if (payslipData.loan_deduction > 0) deductions.push({ name: 'Loan / Advance EMI', amount: payslipData.loan_deduction });
        if (payslipData.other_deduction > 0) deductions.push({ name: 'Other Deductions', amount: payslipData.other_deduction });

        const rowCount = Math.max(earnings.length, deductions.length, 5);
        let rowY = tableTop + 20;
        doc.font('Helvetica').fontSize(8);

        for (let i = 0; i < rowCount; i++) {
          const earnItem = earnings[i];
          const dedItem = deductions[i];

          doc.rect(36, rowY, halfWidth, 18).stroke(borderColor);
          doc.rect(36 + halfWidth, rowY, halfWidth, 18).stroke(borderColor);

          if (earnItem) {
            doc.fillColor(textColor);
            if (hasStandard) {
              doc.text(earnItem.name, 44, rowY + 5, { width: 105 });
              doc.text(earnItem.standard != null ? Number(earnItem.standard).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-', 145, rowY + 5, { align: 'right', width: 65 });
              doc.text(Number(earnItem.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 215, rowY + 5, { align: 'right', width: 75 });
            } else {
              doc.text(earnItem.name, 46, rowY + 5, { width: 140 });
              doc.text(Number(earnItem.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 36 + halfWidth - 95, rowY + 5, { align: 'right', width: 85 });
            }
          }
          if (dedItem) {
            doc.fillColor(textColor).text(dedItem.name, 36 + halfWidth + 10, rowY + 5, { width: 145 });
            doc.text(Number(dedItem.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 36 + tableWidth - 95, rowY + 5, { align: 'right', width: 85 });
          }

          rowY += 18;
        }

        // Totals Footer
        const totalEarnings = Number(payslipData.gross_salary || payslipData.total_earnings || 0);
        const totalDeductions = Number(payslipData.total_deductions || 0);

        doc.rect(36, rowY, halfWidth, 22).fill('#f8fafc');
        doc.rect(36, rowY, halfWidth, 22).stroke(borderColor);
        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5);

        if (hasStandard) {
          doc.text('Gross Earnings:', 44, rowY + 6);
          doc.text(Number(fixedGross).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 145, rowY + 6, { align: 'right', width: 65 });
          doc.text(Number(totalEarnings).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 215, rowY + 6, { align: 'right', width: 75 });
        } else {
          doc.text('Gross Earnings:', 46, rowY + 6);
          doc.text(formatCurr(totalEarnings), 36 + halfWidth - 110, rowY + 6, { align: 'right', width: 100 });
        }

        doc.rect(36 + halfWidth, rowY, halfWidth, 22).fill('#f8fafc');
        doc.rect(36 + halfWidth, rowY, halfWidth, 22).stroke(borderColor);
        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('Total Deductions:', 36 + halfWidth + 10, rowY + 6);
        doc.text(formatCurr(totalDeductions), 36 + tableWidth - 110, rowY + 6, { align: 'right', width: 100 });

        rowY += 32;

        // ── Net Pay Take-Home Box ──
        const netPay = Number(payslipData.net_salary || (totalEarnings - totalDeductions) || 0);
        doc.rect(36, rowY, 523, 44).fill('#ecfdf5'); // emerald-50
        doc.rect(36, rowY, 523, 44).stroke('#6ee7b7'); // emerald-300

        doc.fillColor('#065f46')
           .font('Helvetica-Bold')
           .fontSize(10)
           .text('NET PAYABLE / TAKE HOME', 46, rowY + 8);

        doc.fillColor('#047857')
           .font('Helvetica-Bold')
           .fontSize(16)
           .text(formatCurr(netPay), 46, rowY + 22);

        // Amount in words
        doc.fillColor(mutedColor)
           .font('Helvetica-Oblique')
           .fontSize(8)
           .text(`Amount in words: ${numberToWords(netPay)}`, 240, rowY + 18, { width: 310, align: 'right' });

        rowY += 54;

        // ── Employer Contributions & Monthly CTC ──
        if (payslipData.pf_employer > 0 || payslipData.esi_employer > 0 || payslipData.ctc > 0) {
          doc.rect(36, rowY, 523, 24).fill(lightBg);
          doc.rect(36, rowY, 523, 24).stroke(borderColor);

          doc.font('Helvetica').fontSize(8).fillColor(mutedColor);
          doc.text(`Employer PF: ${formatCurr(payslipData.pf_employer || 0)}`, 46, rowY + 8);
          doc.text(`Employer ESIC: ${formatCurr(payslipData.esi_employer || 0)}`, 200, rowY + 8);
          doc.font('Helvetica-Bold').fillColor(primaryColor);
          doc.text(`Total Monthly CTC: ${formatCurr(payslipData.ctc || (totalEarnings + (payslipData.pf_employer || 0) + (payslipData.esi_employer || 0)))}`, 360, rowY + 8);
          rowY += 34;
        }

        // ── Footer / Signature Disclaimers ──
        doc.rect(36, rowY, 523, 1).fill(borderColor);
        rowY += 10;

        doc.font('Helvetica-Oblique')
           .fontSize(7.5)
           .fillColor(mutedColor)
           .text('This is a system-generated salary slip and does not require a physical signature.', 36, rowY, { align: 'center', width: 523 });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = new PayslipPdfService();
