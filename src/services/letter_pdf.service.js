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
  async generateLetterPDF({ content, fullHtml, employee, title, type, signatory }) {
    if (fullHtml) {
      try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
          headless: "new",
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // Wrap the fullHtml in a minimal document with tailwind reset or basic styles
        const htmlWrapper = `
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
              ${fullHtml}
            </body>
          </html>
        `;
        
        await page.setContent(htmlWrapper, { waitUntil: 'networkidle0' });
        
        // We render it as A4 format
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
}

module.exports = new LetterPdfService();