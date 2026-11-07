const { LetterTemplate, Employee, Office, Company, AuthorisedSignatory, sequelize } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { getPTSlabs } = require('../utils/payrollHelper');


class LetterTemplateService {
  /**
   * Get all templates with optional filtering
   */
  async getTemplates({ type, category, is_active, search, page = 1, limit = 20 } = {}) {
    const where = {};
    if (type) where.type = type;
    if (category) where.category = category;
    if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await LetterTemplate.findAndCountAll({
      where,
      order: [['type', 'ASC'], ['name', 'ASC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      data: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    };
  }

  /**
   * Get all templates (no pagination — for dropdowns and frontend listing)
   */
  async getAllTemplates({ type, category, is_active } = {}) {
    const where = {};
    if (type) where.type = type;
    if (category) where.category = category;
    if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === true;

    return LetterTemplate.findAll({
      where,
      order: [['type', 'ASC'], ['name', 'ASC']],
    });
  }

  /**
   * Get a single template by ID
   */
  async getTemplateById(id) {
    const template = await LetterTemplate.findByPk(id);
    if (!template) {
      const err = new Error('Template not found');
      err.statusCode = 404;
      throw err;
    }
    return template;
  }

  /**
   * Create a new template
   */
  async createTemplate(data, createdBy) {
    const template = await LetterTemplate.create({
      ...data,
      created_by: createdBy,
    });
    logger.info(`Template created: ${template.name} (ID: ${template.id})`);
    return template;
  }

  /**
   * Update an existing template
   */
  async updateTemplate(id, data, updatedBy) {
    const template = await this.getTemplateById(id);
    await template.update({
      ...data,
      created_by: updatedBy,
    });
    logger.info(`Template updated: ${template.name} (ID: ${template.id})`);
    return template;
  }

  /**
   * Delete a template
   */
  async deleteTemplate(id) {
    const template = await this.getTemplateById(id);
    await template.destroy();
    logger.info(`Template deleted: ${template.name} (ID: ${id})`);
    return { deleted: true };
  }

  /**
   * Preview a template with employee data substituted
   * Replaces all placeholders like [Employee_Name], [Job_Title], etc.
   */
  async previewTemplate(templateId, employeeId, candidateData = null, signatoryId = null) {
    const template = await this.getTemplateById(templateId);
    const ptSlabs = await getPTSlabs();

    let signatory = null;
    if (signatoryId) {
      signatory = await AuthorisedSignatory.findByPk(signatoryId);
    }

    let employee = null;
    
    if (employeeId) {
      employee = await Employee.findByPk(employeeId, {
        include: [
          { model: Office, as: 'office', attributes: ['name', 'address', 'city', 'state'] },
          { model: Company, as: 'company', attributes: ['name', 'email', 'phone', 'website', 'city', 'state', 'address'] },
        ],
      });
      if (!employee) {
        const err = new Error('Employee not found');
        err.statusCode = 404;
        throw err;
      }
    } else if (candidateData) {
      let companyDetails = { name: candidateData.company || 'BP Marketing' };
      if (candidateData.company) {
        const foundCompany = await Company.findOne({ where: { name: candidateData.company } });
        if (foundCompany) {
          companyDetails = {
            name: foundCompany.name,
            email: foundCompany.email,
            phone: foundCompany.phone,
            website: foundCompany.website,
            city: foundCompany.city,
            state: foundCompany.state,
            address: foundCompany.address
          };
        }
      }

      // Mock employee object from candidate data
      employee = {
        id: 'candidate',
        name: candidateData.name || 'Candidate',
        emp_code: 'NEW',
        email: candidateData.email || '',
        phone: candidateData.phone || '',
        designation: candidateData.designation || 'TBD',
        department: candidateData.department || 'TBD',
        date_of_joining: candidateData.date_of_joining || new Date(),
        fixed_gross: candidateData.fixed_gross || 0,
        basic_salary: candidateData.basic_salary || 0,
        pf_applicable: candidateData.pf_applicable ?? true,
        pf_ceiling: candidateData.pf_ceiling ?? true,
        pf_contribution_mode: candidateData.pf_contribution_mode || 'shared',
        pf_employer_rate: Number(candidateData.pf_employer_rate ?? 0.12),
        pf_employee_rate: Number(candidateData.pf_employee_rate ?? 0.12),
        esic_applicable: candidateData.esic_applicable ?? true,
        esic_contribution_mode: candidateData.esic_contribution_mode || 'shared',
        esic_employer_rate: Number(candidateData.esic_employer_rate ?? 0.0325),
        esic_employee_rate: Number(candidateData.esic_employee_rate ?? 0.0075),
        pt_applicable: candidateData.pt_applicable !== false,
        office: { name: candidateData.office || 'Head Office', address: '', city: '', state: '' },
        company: companyDetails
      };
    } else {
      const err = new Error('Either employeeId or candidateData is required');
      err.statusCode = 400;
      throw err;
    }

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const fullDateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    // Build substitution map using 40% strict rule
    const gross = Number(employee.fixed_gross) || 0;
    const basic = Math.round(gross * 0.40);
    const hra = Math.round(basic * 0.40);
    const special = gross - basic - hra;

    // Modes
    const pf_applicable = employee.pf_applicable !== false;
    const pf_ceiling = employee.pf_ceiling !== false;
    const pf_mode = employee.pf_contribution_mode || 'shared';
    const esic_applicable = employee.esic_applicable !== false;
    const esic_mode = employee.esic_contribution_mode || 'shared';
    const pt_applicable = employee.pt_applicable !== false;

    // Calculations
    const pfBase = (pf_ceiling && basic > 15000) ? 15000 : basic;
    const pfEmpRate = employee.pf_employer_rate ?? 0.12;
    const pfEpeRate = employee.pf_employee_rate ?? 0.12;
    
    let pfEmployer = 0, pfEmployee = 0;
    if (pf_applicable) {
      if (pf_mode === 'shared' || pf_mode === 'employer_only') pfEmployer = Math.round(pfBase * pfEmpRate);
      if (pf_mode === 'shared' || pf_mode === 'employee_only') pfEmployee = Math.round(pfBase * pfEpeRate);
    }

    const esiEmpRate = employee.esic_employer_rate ?? 0.0325;
    const esiEpeRate = employee.esic_employee_rate ?? 0.0075;

    let esiEmployer = 0, esiEmployee = 0;
    if (esic_applicable) {
      if (esic_mode === 'shared' || esic_mode === 'employer_only') esiEmployer = Math.ceil(gross * esiEmpRate);
      if (esic_mode === 'shared' || esic_mode === 'employee_only') esiEmployee = Math.ceil(gross * esiEpeRate);
    }

    let professionalTax = 0;
    if (pt_applicable) {
      for (const slab of ptSlabs) {
        const toLimit = slab.to === null || slab.to === undefined ? Infinity : slab.to;
        if (gross >= slab.from && gross <= toLimit) {
          professionalTax = slab.amount;
          break;
        }
      }
    }

    const totalDeductions = pfEmployee + esiEmployee + professionalTax;
    const netTakeHome = gross - totalDeductions;
    const ctc = gross + pfEmployer + esiEmployer;

    const basic_annual = basic * 12;
    const hra_annual = hra * 12;
    const special_annual = special * 12;
    const gross_annual = gross * 12;
    const pf_annual = pfEmployer * 12;
    const esi_annual = esiEmployer * 12;
    const pf_emp_annual = pfEmployee * 12;
    const esi_emp_annual = esiEmployee * 12;
    const pt_annual = professionalTax * 12;
    const deductions_annual = totalDeductions * 12;
    const net_annual = netTakeHome * 12;
    const ctc_annual = ctc * 12;

    const placeholders = {
      '[Employee_Name]': employee.name || '_______________',
      '[Employee_Code]': employee.emp_code || '_______________',
      '[Employee_Email]': employee.email || '_______________',
      '[Employee_Phone]': employee.phone || '_______________',
      '[Job_Title]': employee.designation || '_______________',
      '[Department]': employee.department || '_______________',
      '[Date]': dateStr,
      '[Full_Date]': fullDateStr,
      '[Office_Location]': employee.office?.name || '_______________',
      '[Office_Address]': employee.office?.address || '_______________',
      '[Office_City]': employee.office?.city || '_______________',
      '[Office_State]': employee.office?.state || '_______________',
      '[Company_Name]': employee.company?.name || '_______________',
      '[Start_Date]': employee.date_of_joining
        ? new Date(employee.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '_______________',
      '[Joining_Date]': employee.date_of_joining
        ? new Date(employee.date_of_joining).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '_______________',
      '[Manager_Name]': '_______________',
      '[Incident_Date]': '_______________',
      '[Last_Working_Date]': '_______________',
      '[Resignation_Date]': '_______________',
      '[Relieving_Date]': '_______________',
      '[New_Job_Title]': '_______________',
      '[New_Department]': '_______________',
      '[New_Office]': '_______________',
      '[Effective_Date]': '_______________',
      '[Transfer_From]': '_______________',
      '[Transfer_To]': '_______________',
      '[Salary]': gross ? `₹ ${gross.toLocaleString('en-IN')}` : '_______________',
      '[Salary_Annual]': gross_annual ? `₹ ${gross_annual.toLocaleString('en-IN')}` : '_______________',
      '[Basic_Salary]': basic ? `₹ ${basic.toLocaleString('en-IN')}` : '_______________',
      '[Basic_Salary_Annual]': basic_annual ? `₹ ${basic_annual.toLocaleString('en-IN')}` : '_______________',
      '[HRA]': hra ? `₹ ${hra.toLocaleString('en-IN')}` : '_______________',
      '[HRA_Annual]': hra_annual ? `₹ ${hra_annual.toLocaleString('en-IN')}` : '_______________',
      '[Special_Allowance]': special ? `₹ ${special.toLocaleString('en-IN')}` : '_______________',
      '[Special_Allowance_Annual]': special_annual ? `₹ ${special_annual.toLocaleString('en-IN')}` : '_______________',
      '[PF_Employer]': pfEmployer ? `₹ ${pfEmployer.toLocaleString('en-IN')}` : '₹ 0',
      '[PF_Employer_Annual]': pf_annual ? `₹ ${pf_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[ESI_Employer]': esiEmployer ? `₹ ${esiEmployer.toLocaleString('en-IN')}` : '₹ 0',
      '[ESI_Employer_Annual]': esi_annual ? `₹ ${esi_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[PF_Employee]': pfEmployee ? `₹ ${pfEmployee.toLocaleString('en-IN')}` : '₹ 0',
      '[PF_Employee_Annual]': pf_emp_annual ? `₹ ${pf_emp_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[ESI_Employee]': esiEmployee ? `₹ ${esiEmployee.toLocaleString('en-IN')}` : '₹ 0',
      '[ESI_Employee_Annual]': esi_emp_annual ? `₹ ${esi_emp_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[Professional_Tax]': professionalTax ? `₹ ${professionalTax.toLocaleString('en-IN')}` : '₹ 0',
      '[Professional_Tax_Annual]': pt_annual ? `₹ ${pt_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[Total_Deductions]': totalDeductions ? `₹ ${totalDeductions.toLocaleString('en-IN')}` : '₹ 0',
      '[Total_Deductions_Annual]': deductions_annual ? `₹ ${deductions_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[Net_Take_Home]': netTakeHome ? `₹ ${netTakeHome.toLocaleString('en-IN')}` : '₹ 0',
      '[Net_Take_Home_Annual]': net_annual ? `₹ ${net_annual.toLocaleString('en-IN')}` : '₹ 0',
      '[CTC]': ctc ? `₹ ${ctc.toLocaleString('en-IN')}` : '_______________',
      '[CTC_Annual]': ctc_annual ? `₹ ${ctc_annual.toLocaleString('en-IN')}` : '_______________',
      '[Bank_Name]': employee.bank_name || '_______________',
      '[Bank_Account]': employee.bank_account_number || '_______________',
      '[IFSC]': employee.ifsc_code || '_______________',
      '[PAN]': employee.pan_number || '_______________',
      '[PF_Number]': employee.pf_number || '_______________',
      '[UAN]': employee.uan || '_______________',
      '[Signatory_Name]': signatory ? signatory.name : 'Authorised Signatory',
      '[Signatory_Designation]': signatory ? signatory.designation : 'Human Resources',
      '[Signatory_Company]': employee.company?.name || 'Company',
    };

    // Substitute placeholders in content
    let content = template.content;
    for (const [key, value] of Object.entries(placeholders)) {
      content = content.split(key).join(value);
    }

    return {
      template: {
        id: template.id,
        name: template.name,
        type: template.type,
        category: template.category,
        variant_count: template.variant_count,
      },
      employee: {
        id: employee.id,
        name: employee.name,
        emp_code: employee.emp_code,
        designation: employee.designation,
        department: employee.department,
        email: employee.email,
        phone: employee.phone,
        office: employee.office?.name,
        company: employee.company?.name,
        companyDetails: employee.company,
        date: dateStr
      },
      signatory: signatory ? {
        id: signatory.id,
        name: signatory.name,
        designation: signatory.designation,
        signature_url: signatory.signature_url,
      } : null,
      content,
    };
  }

  /**
   * Bulk seed default templates
   */
  async seedDefaultTemplates(createdBy, { force = false } = {}) {
    const existing = await LetterTemplate.count();
    const defaults = this._getDefaultTemplates();

    if (existing > 0 && !force) {
      logger.info('Templates already exist, skipping seed (use force to re-seed/update)');
      return { skipped: true, message: 'Templates already exist. Pass force=true to refresh default templates.' };
    }

    if (force) {
      for (const t of defaults) {
        const found = await LetterTemplate.findOne({ where: { type: t.type, name: t.name } });
        if (found) {
          await found.update({ ...t, created_by: createdBy });
        } else {
          await LetterTemplate.create({ ...t, created_by: createdBy });
        }
      }
      logger.info(`Refreshed ${defaults.length} default templates`);
      return { updated: defaults.length, message: 'Templates refreshed successfully' };
    }

    const templates = await LetterTemplate.bulkCreate(
      defaults.map(t => ({ ...t, created_by: createdBy }))
    );
    logger.info(`Seeded ${templates.length} default templates`);
    return { created: templates.length, templates };
  }

  _getDefaultTemplates() {
    return [
      // ── OFFER LETTER (Req 12.1 & 12.2: Focus on offer terms, joining timeline, and CTC summary) ──
      {
        name: 'Offer Letter (Standard Corporate)',
        type: 'offer',
        category: 'Hiring',
        description: 'Standard corporate offer letter with offered compensation summary and employment terms',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>Following our recent discussions and interview process, we are pleased to extend an offer of employment for the position of <strong>[Job_Title]</strong> in the <strong>[Department]</strong> department at <strong>[Company_Name]</strong>. We were thoroughly impressed by your credentials and are confident that your skills and dedication will be a tremendous addition to our team.</p>

<p><strong>1. Offer Details & Place of Posting</strong><br/>
Your initial posting will be at our <strong>[Office_Location]</strong> office. Your proposed date of joining is <strong>[Joining_Date]</strong>. This offer is contingent upon successful completion of standard reference checks and verification of your educational and professional credentials.</p>

<p><strong>2. Compensation Summary</strong><br/>
Your total offered remuneration will be as summarized below:</p>

<table style="width: 100%; border-collapse: collapse; margin: 16px 0 20px;">
  <thead>
    <tr style="background: rgba(0,0,0,0.05);">
      <th style="padding: 10px 12px; text-align: left; border: 1px solid rgba(0,0,0,0.1);">Compensation Element</th>
      <th style="padding: 10px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">Monthly (₹)</th>
      <th style="padding: 10px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">Annual (₹)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid rgba(0,0,0,0.1);">Total Fixed Gross Remuneration</td>
      <td style="padding: 8px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1); font-weight: 700;">[Salary]</td>
      <td style="padding: 8px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1); font-weight: 700;">[Salary_Annual]</td>
    </tr>
    <tr style="background: rgba(0,0,0,0.03);">
      <td style="padding: 8px 12px; border: 1px solid rgba(0,0,0,0.1);">Target Total Cost to Company (CTC)</td>
      <td style="padding: 8px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1); font-weight: 900;">[CTC]</td>
      <td style="padding: 8px 12px; text-align: right; border: 1px solid rgba(0,0,0,0.1); font-weight: 900;">[CTC_Annual]</td>
    </tr>
  </tbody>
</table>

<p><em>*Note: The comprehensive itemized breakdown of salary components (Basic, HRA, Allowances, PF, ESIC, and Professional Tax) will be formally provided in Annexure A of your Appointment Letter upon joining.</em></p>

<p><strong>3. Key Terms of Employment:</strong></p>
<ul>
  <li><strong>Probation Period:</strong> You will be on probation for an initial period of 3 months from your joining date, extendable based on performance review.</li>
  <li><strong>Working Hours & Policies:</strong> You will adhere to standard office hours and company policies and procedures.</li>
  <li><strong>Notice Period:</strong> A mandatory notice period of 1 month is required upon resignation from the company. Resignation will not be considered valid without completing the required notice period.</li>
  <li><strong>Confidentiality:</strong> You will maintain strict confidentiality regarding all company information, customer data, and proprietary matters.</li>
</ul>

<p><strong>4. Acceptance of Offer:</strong><br/>
Please confirm your acceptance of this offer by signing and returning the duplicate copy of this letter within <strong>3 working days</strong>. We look forward to welcoming you to <strong>[Company_Name]</strong> and building a rewarding career together.</p>`,
      },
      // ── APPOINTMENT LETTER (Req 12.2: Full Appointment Confirmation with Comprehensive Salary Breakup Annexure) ──
      {
        name: 'Appointment Letter',
        type: 'appointment',
        category: 'Hiring',
        description: 'Formal appointment confirmation letter with detailed compensation structure (Annexure A)',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>With reference to your acceptance of our offer letter and subsequent onboarding, we have the pleasure in confirming your appointment as <strong>[Job_Title]</strong> in the <strong>[Department]</strong> department at <strong>[Company_Name]</strong>, effective from <strong>[Start_Date]</strong>.</p>

<p><strong>1. Place of Posting</strong><br/>
Your initial posting will be at our <strong>[Office_Location]</strong> office. However, your services are transferable to any other office, node, branch, or subsidiary of the Company as may be deemed necessary by the Management.</p>

<p><strong>2. Probation & Confirmation</strong><br/>
You will be on probation for a period of <strong>6 months</strong> from your date of joining. Upon successful completion of your probation and satisfactory performance, your services will be confirmed in writing. During or at the end of the probation period, the company reserves the right to extend the probation period or terminate the employment as per policy.</p>

<p><strong>3. Compensation & Benefits (Annexure A)</strong><br/>
Your detailed compensation and salary component structure is set forth in <strong>Annexure A</strong> below. All payments are subject to applicable tax deductions at source (TDS) and statutory compliance as per prevailing government regulations.</p>

<div style="margin: 20px 0;">
  <p style="font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; color: #1e293b;">
    Annexure A — Detailed Compensation & Salary Structure
  </p>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px;">
    <thead>
      <tr style="background: rgba(0,0,0,0.06);">
        <th style="padding: 8px 10px; text-align: left; border: 1px solid rgba(0,0,0,0.12);">Salary Component</th>
        <th style="padding: 8px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12);">Monthly (₹)</th>
        <th style="padding: 8px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12);">Annual (₹)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1);">Basic Salary (40% of Gross)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[Basic_Salary]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[Basic_Salary_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1);">House Rent Allowance (HRA - 40% of Basic)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[HRA]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[HRA_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1);">Special Allowance</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[Special_Allowance]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1);">[Special_Allowance_Annual]</td>
      </tr>
      <tr style="font-weight: 700; background: rgba(0,0,0,0.02);">
        <td style="padding: 7px 10px; border: 1px solid rgba(0,0,0,0.12);">Total Gross Salary (A)</td>
        <td style="padding: 7px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12);">[Salary]</td>
        <td style="padding: 7px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12);">[Salary_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">Less: Employee Provident Fund (PF)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[PF_Employee]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[PF_Employee_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">Less: Employee State Insurance (ESIC)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[ESI_Employee]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[ESI_Employee_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">Less: Professional Tax (PT)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[Professional_Tax]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #dc2626;">-[Professional_Tax_Annual]</td>
      </tr>
      <tr style="font-weight: 700; background: rgba(220,38,38,0.03);">
        <td style="padding: 7px 10px; border: 1px solid rgba(0,0,0,0.12); color: #b91c1c;">Total Employee Deductions (B)</td>
        <td style="padding: 7px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12); color: #b91c1c;">-[Total_Deductions]</td>
        <td style="padding: 7px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.12); color: #b91c1c;">-[Total_Deductions_Annual]</td>
      </tr>
      <tr style="font-weight: 800; background: rgba(16,185,129,0.08);">
        <td style="padding: 8px 10px; border: 1px solid rgba(0,0,0,0.15); color: #065f46;">Net Take-Home Pay (A - B)</td>
        <td style="padding: 8px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.15); color: #065f46;">[Net_Take_Home]</td>
        <td style="padding: 8px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.15); color: #065f46;">[Net_Take_Home_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">Add: Employer Provident Fund (PF)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">[PF_Employer]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">[PF_Employer_Annual]</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">Add: Employer State Insurance (ESIC)</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">[ESI_Employer]</td>
        <td style="padding: 6px 10px; text-align: right; border: 1px solid rgba(0,0,0,0.1); color: #2563eb;">[ESI_Employer_Annual]</td>
      </tr>
      <tr style="font-weight: 900; background: rgba(15,23,42,0.08);">
        <td style="padding: 9px 10px; border: 2px solid rgba(15,23,42,0.2); color: #0f172a;">Total Cost to Company (CTC)</td>
        <td style="padding: 9px 10px; text-align: right; border: 2px solid rgba(15,23,42,0.2); color: #0f172a;">[CTC]</td>
        <td style="padding: 9px 10px; text-align: right; border: 2px solid rgba(15,23,42,0.2); color: #0f172a;">[CTC_Annual]</td>
      </tr>
    </tbody>
  </table>
</div>

<p><strong>4. Confidentiality & Non-Disclosure</strong><br/>
You agree to maintain strict confidentiality regarding all proprietary information, software codes, business strategies, and client data. Any breach shall lead to immediate termination and legal recourse.</p>

<p><strong>5. Notice Period & Resignation</strong><br/>
It is mandatory for the employee to serve a notice period of <strong>1 month</strong> while resigning from the company. Resignation will not be considered valid or accepted without completing the required notice period and proper handover.</p>

<p>We welcome you to the <strong>[Company_Name]</strong> family and wish you a fruitful and rewarding tenure with us.</p>`,
      },
      // ── WARNING LETTER ──
      {
        name: 'Warning Letter',
        type: 'warning',
        category: 'Disciplinary',
        description: 'Formal warning letter for misconduct or policy violation',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>This letter serves as a formal warning regarding the following incident(s) brought to our attention:</p>

<div style="background: rgba(220,38,38,0.05); border: 1px solid rgba(220,38,38,0.2); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Incident Details:</p>
  <p style="margin: 0 0 4px;"><strong>Date of Incident:</strong> [Incident_Date]</p>
  <p style="margin: 0;">[Describe the incident here]</p>
</div>

<p>The above conduct is in violation of the company's policies and code of conduct. Such behavior is unacceptable and will not be tolerated.</p>

<p><strong>This is your first written warning.</strong> You are expected to show immediate and sustained improvement. Any further instances of similar nature will result in escalated disciplinary action, up to and including termination of employment.</p>

<p>Please acknowledge receipt of this warning by signing the copy below.</p>`,
      },
      // ── NON-PERFORMANCE LETTER ──
      {
        name: 'Non-Performance Letter',
        type: 'appointment',
        category: 'Disciplinary',
        description: 'Letter addressing performance concerns',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>This letter is to bring to your attention concerns regarding your performance in the role of <strong>[Job_Title]</strong>. During our recent review, the following areas were identified as needing improvement:</p>

<div style="background: rgba(245,158,11,0.05); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Areas of Concern:</p>
  <ol style="margin: 0; padding-left: 20px;">
    <li>[Area of concern 1]</li>
    <li>[Area of concern 2]</li>
    <li>[Area of concern 3]</li>
  </ol>
</div>

<p>We are placing you on a <strong>Performance Improvement Plan (PIP)</strong> for a period of <strong>30 days</strong>, effective from the date of this letter. During this period, you will be expected to meet the following targets:</p>

<div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Expected Improvements:</p>
  <ol style="margin: 0; padding-left: 20px;">
    <li>[Target 1]</li>
    <li>[Target 2]</li>
    <li>[Target 3]</li>
  </ol>
</div>

<p>Your progress will be reviewed at the end of the PIP period. Failure to meet the required standards may result in further disciplinary action, including termination.</p>

<p>We encourage you to reach out to your manager or HR for any support you may need during this period.</p>`,
      },
      // ── ABSENTEEISM LETTER ──
      {
        name: 'Absenteeism Warning Letter',
        type: 'appointment',
        category: 'Disciplinary',
        description: 'Warning letter for excessive absenteeism',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>Our records indicate that you have been absent from work without prior intimation or approval on multiple occasions. This pattern of absenteeism is a matter of serious concern.</p>

<div style="background: rgba(220,38,38,0.05); border: 1px solid rgba(220,38,38,0.2); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Absence Record:</p>
  <p style="margin: 0 0 4px;">[List of absence dates with reasons, if any]</p>
</div>

<p>Regular attendance is a fundamental requirement of your employment. Failure to report to work without proper authorization constitutes a violation of company policy.</p>

<p><strong>This is a formal notice.</strong> You are required to:</p>
<ol style="margin: 0 0 16px; padding-left: 20px;">
  <li>Report to work regularly and on time.</li>
  <li>Obtain prior approval for any leave through the proper channel.</li>
  <li>Provide a written explanation for past absences within 3 working days.</li>
</ol>

<p>Please note that any further unauthorized absence will result in disciplinary action, which may include deduction of salary, suspension, or termination of employment.</p>`,
      },
      // ── PROMOTION LETTER ──
      {
        name: 'Promotion Letter',
        type: 'promotion',
        category: 'General',
        description: 'Employee promotion confirmation letter',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>We are pleased to inform you that, in recognition of your consistent performance and dedication, you have been promoted to the position of <strong>[New_Job_Title]</strong> in the <strong>[New_Department]</strong> department, effective from <strong>[Effective_Date]</strong>.</p>

<div style="background: rgba(5,150,105,0.05); border: 1px solid rgba(5,150,105,0.2); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Promotion Details:</p>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 4px 8px; width: 140px; font-weight: 600;">Previous Role:</td><td style="padding: 4px 8px;">[Job_Title]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">New Role:</td><td style="padding: 4px 8px;">[New_Job_Title]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Department:</td><td style="padding: 4px 8px;">[New_Department]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Effective Date:</td><td style="padding: 4px 8px;">[Effective_Date]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Revised Salary:</td><td style="padding: 4px 8px; font-weight: 700;">[Salary]</td></tr>
  </table>
</div>

<p>Your revised compensation and benefits will be as per the new grade and will be effective from the date mentioned above. All other terms and conditions of your employment remain unchanged.</p>

<p>We congratulate you on this achievement and look forward to your continued contribution to the growth of <strong>[Company_Name]</strong>.</p>`,
      },
      // ── TRANSFER LETTER ──
      {
        name: 'Transfer Letter',
        type: 'transfer',
        category: 'General',
        description: 'Employee transfer/relocation letter',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>This is to inform you that the management has decided to transfer you from <strong>[Transfer_From]</strong> to <strong>[Transfer_To]</strong>, effective from <strong>[Effective_Date]</strong>.</p>

<div style="background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.2); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Transfer Details:</p>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 4px 8px; width: 140px; font-weight: 600;">Current Location:</td><td style="padding: 4px 8px;">[Transfer_From]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">New Location:</td><td style="padding: 4px 8px;">[Transfer_To]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Role:</td><td style="padding: 4px 8px;">[Job_Title]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Effective Date:</td><td style="padding: 4px 8px;">[Effective_Date]</td></tr>
  </table>
</div>

<p>Your compensation and other terms of employment remain unchanged. Any relocation assistance will be provided as per the company's relocation policy.</p>

<p>Please acknowledge receipt of this transfer letter and complete the necessary formalities before your relocation.</p>`,
      },
      // ── RESIGNATION ACCEPTANCE ──
      {
        name: 'Resignation Acceptance Letter',
        type: 'resignation',
        category: 'Exit',
        description: 'Formal acceptance of employee resignation',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>We acknowledge receipt of your resignation letter dated <strong>[Resignation_Date]</strong>, and we accept your resignation with regret.</p>

<div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Resignation Details:</p>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 4px 8px; width: 160px; font-weight: 600;">Resignation Submitted:</td><td style="padding: 4px 8px;">[Resignation_Date]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Last Working Day:</td><td style="padding: 4px 8px; font-weight: 700;">[Last_Working_Date]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Notice Period:</td><td style="padding: 4px 8px;">30 Days</td></tr>
  </table>
</div>

<p>Your last working day with <strong>[Company_Name]</strong> will be <strong>[Last_Working_Date]</strong>. Please ensure a smooth handover of your responsibilities to your reporting manager before your departure.</p>

<p>Your full and final settlement will be processed as per company policy after the completion of your notice period and clearance from all departments.</p>

<p>We thank you for your contributions during your tenure at <strong>[Company_Name]</strong> and wish you the very best in your future endeavors.</p>`,
      },
      // ── EXPERIENCE LETTER ──
      {
        name: 'Experience Certificate',
        type: 'experience',
        category: 'Exit',
        description: 'Employment experience certificate',
        variant_count: 5,
        is_active: true,
        content: `<p><strong>TO WHOMSOEVER IT MAY CONCERN</strong></p>

<p>This is to certify that <strong>[Employee_Name]</strong> (Employee Code: <strong>[Employee_Code]</strong>) was employed with <strong>[Company_Name]</strong> from <strong>[Joining_Date]</strong> to <strong>[Last_Working_Date]</strong>.</p>

<div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Employment Details:</p>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 4px 8px; width: 140px; font-weight: 600;">Employee Name:</td><td style="padding: 4px 8px;">[Employee_Name]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Employee Code:</td><td style="padding: 4px 8px;">[Employee_Code]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Designation:</td><td style="padding: 4px 8px;">[Job_Title]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Department:</td><td style="padding: 4px 8px;">[Department]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Period:</td><td style="padding: 4px 8px;">[Joining_Date] — [Last_Working_Date]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Location:</td><td style="padding: 4px 8px;">[Office_Location]</td></tr>
  </table>
</div>

<p>During their tenure, <strong>[Employee_Name]</strong> was found to be sincere, hardworking, and professional in their conduct. They discharged their duties with diligence and efficiency.</p>

<p>We wish <strong>[Employee_Name]</strong> all the very best in their future professional and personal endeavors.</p>`,
      },
      // ── RELIEVING LETTER ──
      {
        name: 'Relieving Letter',
        type: 'relieving',
        category: 'Exit',
        description: 'Relieving letter confirming employee clearance',
        variant_count: 5,
        is_active: true,
        content: `<p>Dear <strong>[Employee_Name]</strong>,</p>

<p>This is to confirm that you have been relieved from your duties as <strong>[Job_Title]</strong> with <strong>[Company_Name]</strong>, effective from the close of business on <strong>[Relieving_Date]</strong>.</p>

<div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 16px 20px; margin: 16px 0;">
  <p style="font-weight: 700; margin: 0 0 6px;">Relieving Details:</p>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 4px 8px; width: 160px; font-weight: 600;">Employee Name:</td><td style="padding: 4px 8px;">[Employee_Name]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Employee Code:</td><td style="padding: 4px 8px;">[Employee_Code]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Designation:</td><td style="padding: 4px 8px;">[Job_Title]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Department:</td><td style="padding: 4px 8px;">[Department]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Date of Joining:</td><td style="padding: 4px 8px;">[Joining_Date]</td></tr>
    <tr><td style="padding: 4px 8px; font-weight: 600;">Last Working Day:</td><td style="padding: 4px 8px; font-weight: 700;">[Relieving_Date]</td></tr>
  </table>
</div>

<p>We confirm that you have completed the handover process and cleared all dues. Your full and final settlement is being processed and will be credited within the stipulated time as per company policy.</p>

<p>We thank you for your services and wish you success in your future endeavors.</p>`,
      },
    ];
  }
}

module.exports = new LetterTemplateService();