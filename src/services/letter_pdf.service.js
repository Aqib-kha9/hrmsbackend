const PDFDocument = require('pdfkit');
const { Employee, Office, Company } = require('../models');

/**
 * Generate a professional PDF letter from HTML content.
 * Uses pdfkit for PDF generation with proper formatting.
 */
class LetterPdfService {
  /**
   * Generate a PDF buffer from letter content with employee data
   * @param {Object} params
   * @param {string} params.content - HTML content (already substituted with employee data)
   * @param {Object} params.employee - Employee object
   * @param {string} params.title - Letter title
   * @param {string} params.type - Letter type
   */
  /**
   * Generate a PDF buffer from letter content with employee data.
   * Renders pixel-perfect A4 PDF via Puppeteer with executive letterhead & signatures.
   * Falls back to pdfkit only if Puppeteer fails.
   */
  async generateLetterPDF({ content, fullHtml, employee = {}, title = 'Offer Letter', type = 'offer', signatory = null, metadata = {}, letterDate = null }) {
    let targetHtml = fullHtml;
    if (!targetHtml) {
      targetHtml = this.buildExecutiveLetterHtml({
        content,
        employee,
        title,
        type,
        signatory,
        metadata,
        letterDate,
      });
    }

    if (targetHtml) {
      try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
          headless: "new",
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // Wrap the HTML if not already a full document
        const htmlDoc = targetHtml.includes('<html') ? targetHtml : `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                @page { size: A4; margin: 0; }
                body { margin: 0; padding: 0; display: flex; justify-content: center; background: #fff; }
                * { box-sizing: border-box; }
              </style>
            </head>
            <body>
              ${targetHtml}
            </body>
          </html>
        `;
        
        await page.setContent(htmlDoc, { waitUntil: 'networkidle0' });
        
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '0', bottom: '0', left: '0', right: '0' }
        });
        
        await browser.close();
        return Buffer.from(pdfBytes);
      } catch (err) {
        console.error("Puppeteer PDF generation failed, falling back to pdfkit", err);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 60, right: 60 },
          bufferPages: true,
        });

        const buffers = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // ── HEADER ──
        const companyName = employee.company?.name || 'Company Name';
        doc.fontSize(10).font('Helvetica-Bold').text(companyName.toUpperCase(), { align: 'center' });
        doc.fontSize(8).font('Helvetica').fillColor('#64748b')
          .text(employee.office?.address || '', { align: 'center' });
        doc.moveDown(0.3);

        // Separator line
        doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.moveDown(0.8);

        // ── TITLE ──
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(title, { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica').fillColor('#64748b')
          .text('PRIVATE & CONFIDENTIAL', { align: 'center' });
        doc.moveDown(1.2);

        // ── META INFO ──
        const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        doc.fontSize(9).font('Helvetica').fillColor('#1e293b');
        doc.text(`Date: ${today}`, { continued: false });
        doc.text(`Ref: ${type.toUpperCase()}/${employee.emp_code || 'N/A'}/${today}`, { continued: false });
        doc.moveDown(0.8);

        // ── TO ADDRESS ──
        doc.fontSize(9).font('Helvetica-Bold').text('To,');
        doc.fontSize(10).text(employee.name || 'Employee Name');
        doc.fontSize(9).font('Helvetica').fillColor('#475569')
          .text(`${employee.designation || ''} — ${employee.department || ''}`);
        if (employee.email) doc.text(employee.email);
        doc.moveDown(1);

        // ── BODY CONTENT ──
        // Strip HTML tags and use plain text with basic formatting
        const plainText = this._htmlToPlainText(content);
        const lines = plainText.split('\n');

        doc.fontSize(9.5).font('Helvetica').fillColor('#1e293b');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            doc.moveDown(0.4);
            continue;
          }

          // Check if it's a table-like line (contains | separators)
          if (trimmed.includes(' | ') && (trimmed.match(/\|/g) || []).length >= 2) {
            this._drawTableRow(doc, trimmed);
            continue;
          }

          // Bold lines (all caps or lines starting with certain keywords)
          const isBold = /^[A-Z\s]{4,}$/.test(trimmed)
            || /^(Dear|Sincerely|Yours|Best|Warm|Regards|Thank)/i.test(trimmed)
            || /^[A-Z][a-z]+:/.test(trimmed);

          if (isBold) {
            doc.font('Helvetica-Bold');
          } else {
            doc.font('Helvetica');
          }

          doc.text(trimmed, {
            width: 475,
            align: 'left',
            lineGap: 2,
          });
          doc.moveDown(0.15);
        }

        // ── SIGNATURE BLOCK ──
        if (doc.y > 640) {
          doc.addPage();
        }
        doc.moveDown(1.5);
        const sigY = doc.y;

        // Left: Authorised Signatory
        const leftX = 60;
        doc.moveTo(leftX, sigY).lineTo(leftX + 150, sigY).strokeColor('#0f172a').lineWidth(1.2).stroke();
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(signatory?.name ? signatory.name.toUpperCase() : 'AUTHORISED SIGNATORY', leftX, sigY + 6);
        doc.fontSize(8).font('Helvetica').fillColor('#475569').text(signatory?.designation || 'Human Resources', leftX, sigY + 18);
        doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#64748b').text(`For ${companyName}`, leftX, sigY + 28);

        // Right: Employee Acceptance Signature
        const rightX = 350;
        doc.moveTo(rightX, sigY).lineTo(rightX + 150, sigY).strokeColor('#0f172a').lineWidth(1.2).stroke();
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text('CANDIDATE / EMPLOYEE', rightX, sigY + 6);
        doc.fontSize(8).font('Helvetica').fillColor('#475569').text(employee.name || 'Acceptance Signature', rightX, sigY + 18);
        doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#64748b').text('Acknowledged & Accepted', rightX, sigY + 28);

        // ── FOOTER ──
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
          doc.switchToPage(i);
          doc.fontSize(7).font('Helvetica').fillColor('#94a3b8');
          doc.text(
            `Generated by ${companyName} HRMS | Page ${i + 1} of ${totalPages}`,
            60, 790,
            { align: 'center', width: 475 }
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Draw a simple table row from pipe-separated text
   */
  _drawTableRow(doc, line) {
    const cols = line.split('|').map(c => c.trim());
    const colWidth = 475 / cols.length;
    const startX = 60;
    const y = doc.y;

    cols.forEach((col, i) => {
      const isHeader = col === col.toUpperCase() && col.length > 2;
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.text(col, startX + (i * colWidth), y, {
        width: colWidth - 5,
        align: i === 0 ? 'left' : 'right',
        lineGap: 1,
      });
    });

    // Draw a light separator
    const newY = doc.y + 2;
    doc.moveTo(60, newY).lineTo(535, newY).strokeColor('#f1f5f9').lineWidth(0.3).stroke();
    doc.y = newY + 2;
  }

  /**
   * Convert HTML to readable plain text with basic structure preserved.
   * IMPORTANT: Must decode & FIRST because &nbsp;, <, etc. contain & as a prefix.
   * If we decode bare & first, &nbsp; becomes &nbsp; and never gets decoded to space.
   */
  _htmlToPlainText(html) {
    let text = html
      // Remove style/script tags
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // Replace block elements with newlines
      .replace(/<\/?(div|p|h[1-6]|tr|li|br|table|thead|tbody|th|section|header|footer|article)[^>]*>/gi, '\n')
      .replace(/<\/td>/gi, ' | ')
      .replace(/<\/th>/gi, ' | ')
      .replace(/<td[^>]*>/gi, '')
      .replace(/<th[^>]*>/gi, '')
      // Remove remaining HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities — MUST decode & FIRST before other entities
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/"/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/'/g, "'")
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .replace(/[ \t]+/g, ' ');

    return text;
  }
  /**
   * Build the complete official executive letter HTML document
   * Matches the modern corporate layout with official letterhead, typography, tables, and digital signatures.
   */
  buildExecutiveLetterHtml({
    content = '',
    employee = {},
    title = 'Offer Letter',
    type = 'offer',
    signatory = null,
    metadata = {},
    letterDate = null,
  }) {
    const fs = require('fs');
    const path = require('path');

    // Safe metadata extraction
    const meta = typeof metadata === 'string' ? JSON.parse(metadata || '{}') : (metadata || {});
    const cand = meta.candidate_details || {};

    // Entity details
    const companyName = employee.company?.name || cand.company || 'BP Marketing';
    const officeName = employee.office?.name || cand.office || 'Indore HQ';

    // Recipient details
    const recipientName = employee.name || cand.name || 'Candidate';
    const recipientEmail = employee.email || cand.email || '';
    const recipientPhone = employee.phone || cand.phone || '';
    const recipientRole = employee.designation || cand.designation || 'Specialist';
    const recipientDept = employee.department || cand.department || 'Operations';

    // Dates & Reference code
    const formattedDate = letterDate
      ? new Date(letterDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const refCode = `${(type || 'OFFER').toUpperCase()}/${recipientName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

    // Signatory details
    const signatoryName = signatory?.name || 'Authorised Signatory';
    const signatoryDesig = signatory?.designation || 'Human Resources';
    const signatorySig = signatory?.signature_url || null;

    // Digital Acceptance details
    const isAccepted = meta.acceptance_status === 'accepted' || Boolean(meta.candidate_signature);
    const candidateSig = meta.candidate_signature || null;
    const signedName = meta.signed_name || recipientName;
    const acceptedDate = meta.accepted_at
      ? new Date(meta.accepted_at).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    // Base64 Logo
    let logoB64 = '';
    try {
      const candidatePaths = [
        path.join(__dirname, '..', '..', 'assets', 'company_logo.png'),
        path.join(__dirname, '..', 'assets', 'company_logo.png'),
        path.join(__dirname, '..', '..', '..', 'hrms', 'public', 'company_logopng.png'),
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          logoB64 = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
          break;
        }
      }
    } catch {
      // Non-critical
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title || 'Employment Document'}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 16mm 14mm 16mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .letter-header {
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .brand-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .company-logo {
      height: 48px;
      width: auto;
      object-fit: contain;
    }
    .company-title {
      font-size: 20px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: -0.5px;
      color: #0f172a;
      margin: 0;
    }
    .company-sub {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
      font-weight: 600;
    }
    .doc-meta {
      text-align: right;
      font-size: 10px;
      color: #475569;
      font-weight: 600;
      line-height: 1.5;
    }
    .badge-confidential {
      display: inline-block;
      background: #f1f5f9;
      color: #334155;
      font-size: 8.5px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
      margin-top: 4px;
    }
    .recipient-block {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .recipient-info {
      font-size: 12px;
      line-height: 1.5;
    }
    .recipient-name {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
    }
    .recipient-role {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    .letter-title {
      text-align: center;
      margin: 18px 0 16px 0;
    }
    .letter-title h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #0f172a;
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    .letter-body {
      font-size: 12.5px;
      color: #1e293b;
      line-height: 1.65;
    }
    .letter-body p {
      margin: 0 0 10px 0;
    }
    .letter-body strong {
      color: #0f172a;
    }
    .letter-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 11.5px;
    }
    .letter-body th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 800;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
      border: 1px solid #cbd5e1;
      padding: 7px 10px;
      text-align: left;
    }
    .letter-body td {
      border: 1px solid #e2e8f0;
      padding: 6px 10px;
      color: #334155;
    }
    .letter-body tr:nth-child(even) td {
      background: #f8fafc;
    }
    .signatures-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      gap: 30px;
      page-break-inside: avoid;
    }
    .sig-col {
      flex: 1;
      max-width: 48%;
    }
    .sig-box-auth {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      background: #ffffff;
    }
    .sig-box-cand {
      border: 1.5px solid #10b981;
      background: #ecfdf5;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .sig-box-cand-pending {
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 12px 16px;
      background: #f8fafc;
    }
    .sig-header {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
      color: #64748b;
    }
    .sig-header-verified {
      color: #065f46;
      font-weight: 900;
    }
    .sig-img {
      max-height: 48px;
      width: auto;
      object-fit: contain;
      display: block;
      margin: 6px 0;
      background: #ffffff;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .sig-name {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
    }
    .sig-desig {
      font-size: 11px;
      color: #64748b;
    }
    .sig-stamp {
      font-size: 9.5px;
      color: #047857;
      font-weight: 700;
      margin-top: 4px;
      font-family: monospace;
    }
    .footer-note {
      margin-top: 25px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
      text-align: center;
      font-size: 8.5px;
      color: #94a3b8;
      line-height: 1.4;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="letter-header">
    <div class="brand-section">
      ${logoB64 ? `<img src="${logoB64}" class="company-logo" alt="Logo" />` : ''}
      <div>
        <h1 class="company-title">${companyName}</h1>
        <div class="company-sub">${officeName} • Official Employment Correspondence</div>
      </div>
    </div>
    <div class="doc-meta">
      <div><strong>Date:</strong> ${formattedDate}</div>
      <div><strong>Ref:</strong> ${refCode}</div>
      <div class="badge-confidential">Official Document</div>
    </div>
  </div>

  <div class="recipient-block">
    <div class="recipient-info">
      <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 2px;">Issued To:</div>
      <div class="recipient-name">${recipientName}</div>
      <div class="recipient-role">${recipientRole} — ${recipientDept}</div>
      <div style="font-size: 11px; color: #64748b;">${recipientEmail}${recipientPhone ? ' • ' + recipientPhone : ''}</div>
    </div>
    <div style="text-align: right; font-size: 11px; color: #475569;">
      <div><strong>Location:</strong> ${officeName}</div>
      <div><strong>Entity:</strong> ${companyName}</div>
    </div>
  </div>

  <div class="letter-title">
    <h1>${title || 'OFFER LETTER'}</h1>
  </div>

  <div class="letter-body">
    ${content || ''}
  </div>

  <div class="signatures-section">
    <div class="sig-col">
      <div class="sig-box-auth">
        <div class="sig-header">Authorised Signatory</div>
        ${signatorySig ? `<img src="${signatorySig}" class="sig-img" alt="Signatory Signature" />` : '<div style="height: 38px; border-bottom: 1.5px solid #0f172a; width: 140px; margin-bottom: 6px;"></div>'}
        <div class="sig-name">${signatoryName}</div>
        <div class="sig-desig">${signatoryDesig}</div>
        <div style="font-size: 9px; color: #94a3b8; margin-top: 3px;">For & on behalf of ${companyName}</div>
      </div>
    </div>

    <div class="sig-col">
      ${isAccepted && candidateSig ? `
        <div class="sig-box-cand">
          <div class="sig-header sig-header-verified">
            <span>✓ Candidate Digital Acceptance</span>
          </div>
          <img src="${candidateSig}" class="sig-img" alt="Candidate Digital Signature" />
          <div class="sig-name" style="color: #064e3b;">${signedName}</div>
          <div class="sig-stamp">Signed: ${acceptedDate}</div>
          <div style="font-size: 8px; color: #059669; margin-top: 2px;">Verified Digital Signature • IT Act Compliant</div>
        </div>
      ` : `
        <div class="sig-box-cand-pending">
          <div class="sig-header">Candidate Acceptance & Signature</div>
          <div style="height: 38px; border-bottom: 1.5px solid #cbd5e1; width: 140px; margin-bottom: 6px;"></div>
          <div class="sig-name">${recipientName}</div>
          <div class="sig-desig">Candidate Signature</div>
          <div style="font-size: 8.5px; color: #94a3b8; margin-top: 3px;">Subject to candidate acceptance & sign</div>
        </div>
      `}
    </div>
  </div>

  <div class="footer-note">
    This is an official document generated by ${companyName} HRMS • Verification ID: ${refCode} • Confidential
  </div>
</body>
</html>`;
  }
}

module.exports = new LetterPdfService();