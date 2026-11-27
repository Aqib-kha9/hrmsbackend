const {
  Employee,
  Office,
  Company,
  SalaryStructure,
  MinimumWage,
  ProfessionalTaxSlab,
  sequelize,
} = require('../models');
const {
  calculateSalaryStructure,
  calculateProfessionalTax,
  round2,
} = require('../utils/salaryCalculatorEngine');
const logger = require('../utils/logger');
const XLSX = require('xlsx');

class SalaryStructureController {
  /**
   * POST /api/v1/payroll/calculate-ctc
   * Stateless simulator endpoint
   */
  async calculateCTC(req, res, next) {
    try {
      const {
        basis = 'CTC',
        amount = 0,
        isMonthly = true,
        state = 'MP',
        wagesCategory = 'Skilled',
        basicPct = 0.50,
        hraPct = 0.40,
        otherFixedAllowances = 0,
        pfApplicable = false,
        pfWageLimit = 25000,
        employerPfPct = 0.13,
        employeePfPct = 0.12,
        esicApplicable = false,
        esicCalcBase = 'Basic',
        esicWageLimit = 21000,
        employerEsicPct = 0.0325,
        employeeEsicPct = 0.0075,
        gratuityApplicable = true,
        gratuityPct = 0.0481,
        bonusApplicable = false,
        bonusPct = 0.0833,
        ptApplicable = true,
        gender = 'All',
        tdsMonthly = 0,
        lwfMonthly = 0,
        loanEmiMonthly = 0,
        otherDeductionsMonthly = 0,
        currentTakeHome = 0,
      } = req.body;

      // 1. Fetch Minimum Wage from DB if not manually passed
      let minWage = Number(req.body.minimumWage);
      if (isNaN(minWage) || minWage <= 0) {
        const mwRecord = await MinimumWage.findOne({
          where: { state, wages_category: wagesCategory, is_active: true },
        });
        minWage = mwRecord ? Number(mwRecord.monthly_wage) : 0;
      }

      // 2. Fetch all PT slabs from DB
      const ptSlabs = await ProfessionalTaxSlab.findAll({ raw: true });

      // 3. Compute breakup
      const result = calculateSalaryStructure({
        basis,
        amount: Number(amount) || 0,
        isMonthly: Boolean(isMonthly),
        state,
        wagesCategory,
        minimumWage: minWage,
        basicPct: Number(basicPct),
        hraPct: Number(hraPct),
        otherFixedAllowances: Number(otherFixedAllowances) || 0,
        pfApplicable,
        pfWageLimit: Number(pfWageLimit),
        employerPfPct: Number(employerPfPct),
        employeePfPct: Number(employeePfPct),
        esicApplicable,
        esicCalcBase,
        esicWageLimit: Number(esicWageLimit),
        employerEsicPct: Number(employerEsicPct),
        employeeEsicPct: Number(employeeEsicPct),
        gratuityApplicable,
        gratuityPct: Number(gratuityPct),
        bonusApplicable,
        bonusPct: Number(bonusPct),
        ptApplicable,
        gender,
        tdsMonthly: Number(tdsMonthly) || 0,
        lwfMonthly: Number(lwfMonthly) || 0,
        loanEmiMonthly: Number(loanEmiMonthly) || 0,
        otherDeductionsMonthly: Number(otherDeductionsMonthly) || 0,
        currentTakeHome: Number(currentTakeHome) || 0,
        customPtSlabs: ptSlabs,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error('Error calculating CTC structure:', err);
      next(err);
    }
  }

  /**
   * GET /api/v1/payroll/minimum-wages
   */
  async getMinimumWages(req, res, next) {
    try {
      const records = await MinimumWage.findAll({
        where: { is_active: true },
        order: [['state', 'ASC'], ['monthly_wage', 'ASC']],
      });

      const states = [...new Set(records.map((r) => r.state))];
      const categories = [...new Set(records.map((r) => r.wages_category))];

      return res.status(200).json({
        success: true,
        data: {
          records,
          states,
          categories,
        },
      });
    } catch (err) {
      logger.error('Error fetching minimum wages:', err);
      next(err);
    }
  }

  /**
   * POST /api/v1/payroll/minimum-wages
   * Upsert minimum wage
   */
  async updateMinimumWage(req, res, next) {
    try {
      const { state, wages_category, monthly_wage, remark, effective_from } = req.body;
      if (!state || !wages_category || monthly_wage === undefined) {
        return res.status(400).json({ success: false, message: 'State, category, and monthly wage are required' });
      }

      const [record, created] = await MinimumWage.findOrCreate({
        where: { state, wages_category },
        defaults: {
          monthly_wage,
          remark,
          effective_from,
          is_active: true,
        },
      });

      if (!created) {
        await record.update({
          monthly_wage,
          remark: remark || record.remark,
          effective_from: effective_from || record.effective_from,
        });
      }

      return res.status(200).json({
        success: true,
        message: created ? 'Minimum wage created' : 'Minimum wage updated',
        data: record,
      });
    } catch (err) {
      logger.error('Error updating minimum wage:', err);
      next(err);
    }
  }

  /**
   * GET /api/v1/payroll/pt-slabs
   */
  async getPTSlabs(req, res, next) {
    try {
      const records = await ProfessionalTaxSlab.findAll({
        order: [['state', 'ASC'], ['gender', 'ASC'], ['salary_from', 'ASC']],
      });

      return res.status(200).json({
        success: true,
        data: records,
      });
    } catch (err) {
      logger.error('Error fetching PT slabs:', err);
      next(err);
    }
  }

  /**
   * GET /api/v1/payroll/salary-structures
   * Company-wide employee salary structures (matching 83-column roster)
   */
  async getSalaryStructures(req, res, next) {
    try {
      const { search, company_id, office_id, state } = req.query;

      const employeeWhere = { status: 'active' };
      if (company_id) employeeWhere.company_id = company_id;
      if (office_id) employeeWhere.office_id = office_id;

      const employees = await Employee.findAll({
        where: employeeWhere,
        include: [
          { model: Office, as: 'office' },
          { model: Company, as: 'company' },
          {
            model: SalaryStructure,
            as: 'salaryStructures',
            where: { effective_to: null },
            required: false,
          },
        ],
        order: [['name', 'ASC']],
      });

      const ptSlabs = await ProfessionalTaxSlab.findAll({ raw: true });
      const minWages = await MinimumWage.findAll({ raw: true });

      const roster = employees.map((emp) => {
        const struct = (emp.salaryStructures && emp.salaryStructures[0]) || null;
        const empState = struct?.state || emp.office?.state || 'MP';
        const empCat = struct?.wages_category || 'Skilled';

        // Find applicable minimum wage
        const matchedMW = minWages.find(
          (m) => m.state.toUpperCase() === empState.toUpperCase() && m.wages_category.toUpperCase() === empCat.toUpperCase()
        );
        const minWageMonthly = matchedMW ? Number(matchedMW.monthly_wage) : Number(struct?.minimum_wage || 0);

        // Derive live calculation
        const ctcAnnual = Number(struct?.annual_ctc || 0);
        const calc = calculateSalaryStructure({
          basis: struct?.calculation_basis || 'CTC',
          amount: ctcAnnual > 0 ? ctcAnnual : Number(struct?.fixed_gross || 0) * 12,
          isMonthly: false,
          state: empState,
          wagesCategory: empCat,
          minimumWage: minWageMonthly,
          basicPct: Number(struct?.basic_pct || 0.50),
          hraPct: Number(struct?.hra_pct || 0.40),
          pfApplicable: Boolean(struct?.pf_applicable),
          pfWageLimit: Number(struct?.pf_wage_limit || 25000),
          esicApplicable: Boolean(struct?.esic_applicable),
          esicCalcBase: struct?.esic_calc_base || 'Basic',
          esicWageLimit: Number(struct?.esic_wage_limit || 21000),
          gratuityApplicable: Boolean(struct?.gratuity_applicable ?? true),
          bonusApplicable: Boolean(struct?.bonus_applicable),
          ptApplicable: Boolean(struct?.pt_applicable ?? true),
          ptAmount: Number(struct?.pt_amount || 0),
          gender: emp.gender || 'All',
          tdsMonthly: Number(struct?.tds_monthly || 0),
          lwfMonthly: Number(struct?.lwf_monthly || 0),
          loanEmiMonthly: Number(struct?.loan_emi_monthly || 0),
          otherDeductionsMonthly: Number(struct?.other_deductions_monthly || 0),
          currentTakeHome: Number(struct?.current_take_home || 0),
          customPtSlabs: ptSlabs,
        });

        return {
          employeeId: emp.id,
          empCode: emp.emp_code,
          name: emp.name,
          designation: emp.designation,
          companyName: emp.company?.name || 'BP Marketing',
          companyId: emp.company_id,
          officeName: emp.office?.name || 'Indore HQ',
          officeId: emp.office_id,
          state: empState,
          wagesCategory: empCat,
          minimumWageMonthly: minWageMonthly,
          structureId: struct?.id || null,
          calculationBasis: struct?.calculation_basis || 'CTC',
          annualCTC: calc.annual.ctc,
          monthlyCTC: calc.monthly.ctc,
          annualGross: calc.annual.gross,
          monthlyGross: calc.monthly.gross,
          annualBasic: calc.annual.basic,
          monthlyBasic: calc.monthly.basic,
          annualHra: calc.annual.hra,
          monthlyHra: calc.monthly.hra,
          annualSpecialAllowance: calc.annual.specialAllowance,
          monthlySpecialAllowance: calc.monthly.specialAllowance,
          employerPfAnnual: calc.annual.employerPf,
          employerEsicAnnual: calc.annual.employerEsic,
          gratuityAnnual: calc.annual.gratuity,
          statutoryBonusAnnual: calc.annual.statutoryBonus,
          exgratiaBonusAnnual: calc.annual.exgratiaBonus,
          employeePfAnnual: calc.annual.employeePf,
          employeeEsicAnnual: calc.annual.employeeEsic,
          ptAnnual: calc.annual.pt,
          totalDeductionsAnnual: calc.annual.totalDeductions,
          netTakeHomeAnnual: calc.annual.netTakeHome,
          netTakeHomeMonthly: calc.monthly.netTakeHome,
          currentTakeHomeMonthly: Number(struct?.current_take_home || 0),
          differenceInTakeHome: calc.meta.differenceInTakeHome,
          basicCalculatedOn: calc.meta.basicCalculatedOn,
          isSpecialAllowanceNegative: calc.meta.isSpecialAllowanceNegative,
          pfApplicable: Boolean(struct?.pf_applicable),
          esicApplicable: Boolean(struct?.esic_applicable),
          bonusApplicable: Boolean(struct?.bonus_applicable),
        };
      });

      // Filter by search query if passed
      let filteredRoster = roster;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        filteredRoster = roster.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.empCode.toLowerCase().includes(q) ||
            r.designation.toLowerCase().includes(q) ||
            r.officeName.toLowerCase().includes(q)
        );
      }
      if (state) {
        filteredRoster = filteredRoster.filter((r) => r.state.toUpperCase() === state.toUpperCase());
      }

      return res.status(200).json({
        success: true,
        data: filteredRoster,
        total: filteredRoster.length,
      });
    } catch (err) {
      logger.error('Error fetching employee salary structures roster:', err);
      next(err);
    }
  }

  /**
   * PUT /api/v1/payroll/salary-structures/:employeeId
   * Save or update an employee's salary structure
   */
  async updateEmployeeSalaryStructure(req, res, next) {
    const t = await sequelize.transaction();
    try {
      const { employeeId } = req.params;
      const emp = await Employee.findByPk(employeeId, { transaction: t });
      if (!emp) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Employee not found' });
      }

      const {
        calculation_basis = 'CTC',
        amount = 0,
        isMonthly = true,
        state = 'MP',
        wages_category = 'Skilled',
        basic_pct = 0.50,
        hra_pct = 0.40,
        other_fixed_allowances = 0,
        pf_applicable = false,
        pf_wage_limit = 25000,
        esic_applicable = false,
        esic_calc_base = 'Basic',
        esic_wage_limit = 21000,
        gratuity_applicable = true,
        bonus_applicable = false,
        pt_applicable = true,
        pt_amount = 0,
        tds_monthly = 0,
        lwf_monthly = 0,
        loan_emi_monthly = 0,
        other_deductions_monthly = 0,
        current_take_home = 0,
      } = req.body;

      // Look up minimum wage
      let minWage = Number(req.body.minimum_wage);
      if (isNaN(minWage) || minWage <= 0) {
        const mw = await MinimumWage.findOne({
          where: { state, wages_category, is_active: true },
          transaction: t,
        });
        minWage = mw ? Number(mw.monthly_wage) : 0;
      }

      const ptSlabs = await ProfessionalTaxSlab.findAll({ raw: true, transaction: t });

      // Run calculation engine
      const calc = calculateSalaryStructure({
        basis: calculation_basis,
        amount: Number(amount) || 0,
        isMonthly: Boolean(isMonthly),
        state,
        wagesCategory: wages_category,
        minimumWage: minWage,
        basicPct: Number(basic_pct),
        hraPct: Number(hra_pct),
        otherFixedAllowances: Number(other_fixed_allowances) || 0,
        pfApplicable: Boolean(pf_applicable),
        pfWageLimit: Number(pf_wage_limit),
        esicApplicable: Boolean(esic_applicable),
        esicCalcBase: esic_calc_base,
        esicWageLimit: Number(esic_wage_limit),
        gratuityApplicable: Boolean(gratuity_applicable),
        bonusApplicable: Boolean(bonus_applicable),
        ptApplicable: Boolean(pt_applicable),
        ptAmount: Number(pt_amount) || 0,
        gender: emp.gender || 'All',
        tdsMonthly: Number(tds_monthly) || 0,
        lwfMonthly: Number(lwf_monthly) || 0,
        loanEmiMonthly: Number(loan_emi_monthly) || 0,
        otherDeductionsMonthly: Number(other_deductions_monthly) || 0,
        currentTakeHome: Number(current_take_home) || 0,
        customPtSlabs: ptSlabs,
      });

      // Find existing active structure
      const existing = await SalaryStructure.findOne({
        where: { employee_id: employeeId, effective_to: null },
        transaction: t,
      });

      const payload = {
        employee_id: employeeId,
        calculation_basis,
        state,
        wages_category,
        minimum_wage: minWage,
        basic_pct,
        hra_pct,
        annual_ctc: calc.annual.ctc,
        fixed_gross: calc.monthly.gross,
        basic_salary: calc.monthly.basic,
        hra: calc.monthly.hra,
        special_allowance: calc.monthly.specialAllowance,
        other_allowance: calc.monthly.otherFixed,
        pf_applicable: Boolean(pf_applicable),
        pf_wage_limit,
        esic_applicable: Boolean(esic_applicable),
        esic_calc_base,
        esic_wage_limit,
        gratuity_applicable: Boolean(gratuity_applicable),
        gratuity_amount: calc.annual.gratuity,
        bonus_applicable: Boolean(bonus_applicable),
        statutory_bonus: calc.annual.statutoryBonus,
        exgratia_bonus: calc.annual.exgratiaBonus,
        pt_applicable: Boolean(pt_applicable),
        pt_amount: calc.monthly.pt,
        tds_monthly,
        lwf_monthly,
        loan_emi_monthly,
        other_deductions_monthly,
        net_take_home: calc.monthly.netTakeHome,
        current_take_home,
        effective_from: req.body.effective_from || new Date().toISOString().split('T')[0],
        updated_by: req.user?.id || null,
      };

      let resultRecord;
      if (existing) {
        resultRecord = await existing.update(payload, { transaction: t });
      } else {
        resultRecord = await SalaryStructure.create(
          { ...payload, created_by: req.user?.id || null },
          { transaction: t }
        );
      }

      await t.commit();

      return res.status(200).json({
        success: true,
        message: 'Salary structure updated successfully',
        data: {
          structure: resultRecord,
          breakdown: calc,
        },
      });
    } catch (err) {
      await t.rollback();
      logger.error('Error updating employee salary structure:', err);
      next(err);
    }
  }

  /**
   * POST /api/v1/payroll/salary-structures/import-client-excel
   * Upload & ingest Final_CTC_Structure_Calculator_Exgretia_Horizontal-1=.xlsx
   */
  async importClientExcel(req, res, next) {
    const t = await sequelize.transaction();
    try {
      if (!req.file && !req.body.filePath) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Excel file is required' });
      }

      let workbook;
      if (req.file && req.file.buffer) {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      } else {
        const filePath = req.file ? req.file.path : req.body.filePath;
        workbook = XLSX.readFile(filePath);
      }
      const sheetName = workbook.SheetNames[0]; // First sheet is CTC_Calculator
      const sheet = workbook.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json(sheet, { header: 'A', range: 3 }); // Row 4 onwards
      const bcrypt = require('bcryptjs');
      const defaultPassword = await bcrypt.hash('Password@123', 10);

      // Default role
      const { Role } = require('../models');
      const employeeRole = await Role.findOne({ where: { name: 'EMPLOYEE' }, transaction: t });

      let importedCount = 0;
      let matchedCount = 0;
      let createdCount = 0;

      for (const row of rows) {
        const empCodeRaw = row['B'] ? String(row['B']).trim() : '';
        const empName = row['C'] ? String(row['C']).trim() : '';
        if (!empName) continue;

        const designation = row['D'] ? String(row['D']).trim() : 'Executive';
        const locationName = row['E'] ? String(row['E']).trim() : 'Indore';
        const companyName = row['F'] ? String(row['F']).trim() : 'BP Marketing';
        const state = row['G'] ? String(row['G']).trim() : 'MP';
        const wagesCategory = row['H'] ? String(row['H']).trim() : 'Skilled';
        const minWage = Number(row['I']) || 0;
        const basis = row['J'] ? String(row['J']).trim() : 'CTC';
        const annualCTC = Number(row['AG']) || Number(row['K']) || 0;
        const monthlyGross = Number(row['BH']) || Number(row['L']) || 0;
        const monthlyBasic = Number(row['BI']) || 0;
        const monthlyHra = Number(row['BJ']) || 0;
        const monthlySpecial = Number(row['BL']) || 0;
        const pfApplicable = String(row['Q']).trim().toLowerCase() === 'yes';
        const esicApplicable = String(row['V']).trim().toLowerCase() === 'yes';
        const esicBase = String(row['W']).trim().toLowerCase() === 'gross' ? 'Gross' : 'Basic';
        const bonusApplicable = String(row['T']).trim().toLowerCase() === 'yes';
        const ptMonthly = Number(row['BP']) || Number(row['AA']) || 0;
        const netTakeHome = Number(row['BV']) || Number(row['BA']) / 12 || 0;
        const currentTakeHome = Number(row['CD']) || 0;

        // 1. Find or create Company
        let [company] = await Company.findOrCreate({
          where: { name: companyName },
          defaults: {
            name: companyName,
            code: companyName.split(' ').map((w) => w[0]).join('').toUpperCase() || 'BPM',
            city: locationName,
            state: state === 'MP' ? 'Madhya Pradesh' : state,
            is_active: true,
          },
          transaction: t,
        });

        // 2. Find or create Office
        let office = await Office.findOne({
          where: { company_id: company.id, city: locationName },
          transaction: t,
        });

        if (!office) {
          const codeSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
          const cleanLoc = locationName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
          office = await Office.create(
            {
              company_id: company.id,
              name: `${companyName} — ${locationName}`,
              code: `LOC-${company.id}-${cleanLoc}-${codeSuffix}`,
              city: locationName,
              state: state === 'MP' ? 'Madhya Pradesh' : state,
              latitude: 22.7196,
              longitude: 75.8577,
              radius_meters: 500,
            },
            { transaction: t }
          );
        }

        // 3. Find or create Employee
        const empCode = empCodeRaw || `BPM${String(1000 + matchedCount + createdCount).padStart(4, '0')}`;
        let employee = await Employee.findOne({
          where: { emp_code: empCode },
          transaction: t,
        });

        if (!employee && empName) {
          employee = await Employee.findOne({
            where: { name: empName },
            transaction: t,
          });
        }

        if (!employee) {
          const cleanEmailSlug = empName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
          const cleanEmpCode = empCode.toLowerCase().replace(/[^a-z0-9]/g, '');
          const email = `${cleanEmailSlug}.${cleanEmpCode}@bpmarketing.com`;

          employee = await Employee.create(
            {
              emp_code: empCode,
              name: empName,
              email,
              password: defaultPassword,
              designation,
              department: 'Operations',
              role_id: employeeRole?.id || null,
              role: 'employee',
              status: 'active',
              company_id: company.id,
              company_name: company.name,
              office_id: office.id,
              location: locationName,
              fixed_gross: monthlyGross,
              basic_salary: monthlyBasic,
              annual_ctc: annualCTC,
              pf_applicable: pfApplicable,
              esic_applicable: esicApplicable,
            },
            { transaction: t }
          );
          createdCount++;
        } else {
          matchedCount++;
          await employee.update(
            {
              designation: designation || employee.designation,
              company_id: company.id,
              company_name: company.name,
              office_id: office.id,
              location: locationName,
            },
            { transaction: t }
          );
        }

        // 4. Upsert active SalaryStructure
        const existing = await SalaryStructure.findOne({
          where: { employee_id: employee.id, effective_to: null },
          transaction: t,
        });

        const structData = {
          employee_id: employee.id,
          calculation_basis: basis,
          state,
          wages_category: wagesCategory,
          minimum_wage: minWage,
          basic_pct: Number(row['M']) || 0.50,
          hra_pct: Number(row['N']) || 0.40,
          annual_ctc: annualCTC,
          fixed_gross: monthlyGross,
          basic_salary: monthlyBasic,
          hra: monthlyHra,
          special_allowance: monthlySpecial,
          pf_applicable: pfApplicable,
          pf_wage_limit: Number(row['R']) || 25000,
          esic_applicable: esicApplicable,
          esic_calc_base: esicBase,
          esic_wage_limit: Number(row['Z']) || 21000,
          gratuity_applicable: true,
          gratuity_amount: Number(row['AJ']) || 0,
          bonus_applicable: bonusApplicable,
          statutory_bonus: Number(row['AK']) || 0,
          exgratia_bonus: Number(row['AL']) || 0,
          pt_applicable: ptMonthly > 0,
          pt_amount: ptMonthly,
          net_take_home: netTakeHome,
          current_take_home: currentTakeHome,
          effective_from: new Date().toISOString().split('T')[0],
        };

        if (existing) {
          await existing.update(structData, { transaction: t });
        } else {
          await SalaryStructure.create(structData, { transaction: t });
        }
        importedCount++;
      }

      await t.commit();

      return res.status(200).json({
        success: true,
        message: `Successfully processed ${rows.length} rows. Created ${createdCount} employees, updated ${matchedCount} existing, and synced ${importedCount} salary structures.`,
        data: {
          totalRows: rows.length,
          createdEmployees: createdCount,
          matchedEmployees: matchedCount,
          updatedStructures: importedCount,
        },
      });
    } catch (err) {
      await t.rollback();
      logger.error('Error importing client excel:', err);
      next(err);
    }
  }

  /**
   * GET /api/v1/payroll/salary-structures/export-excel
   * Download company-wide 83-column spreadsheet matching client format with full live Excel formulas
   */
  async exportSalaryStructuresExcel(req, res, next) {
    try {
      const employees = await Employee.findAll({
        where: { status: 'active' },
        include: [
          { model: Office, as: 'office' },
          { model: Company, as: 'company' },
          {
            model: SalaryStructure,
            as: 'salaryStructures',
            where: { effective_to: null },
            required: false,
          },
        ],
        order: [['name', 'ASC']],
      });

      const ptSlabs = await ProfessionalTaxSlab.findAll({ raw: true });
      const minWages = await MinimumWage.findAll({ raw: true });

      const templatePath = path.join(__dirname, '../../templates/Final_CTC_Structure_Calculator_Exgretia_Horizontal-1=.xlsx');
      let wb;
      if (fs.existsSync(templatePath)) {
        wb = XLSX.readFile(templatePath, { cellFormula: true, cellStyles: true });
      } else {
        wb = XLSX.utils.book_new();
      }

      // Sanitize Defined Names (eliminates "Removed Records: Named range from /xl/workbook.xml")
      wb.Workbook = wb.Workbook || {};
      wb.Workbook.Names = [
        {
          Name: 'CategoryList',
          Ref: "OFFSET('Minimum Wages'!$I$2,0,0,MAX(1,COUNTIF('Minimum Wages'!$I$2:$I$300,\"*\")),1)",
        },
        {
          Name: 'StateList',
          Ref: "OFFSET('Minimum Wages'!$G$2,0,0,MAX(1,COUNTIF('Minimum Wages'!$G$2:$G$300,\"*\")),1)",
        },
        {
          Name: 'PT_State_List',
          Ref: 'PT!$T$3:$T$34',
        },
      ];

      // Clean PT sheet (eliminates "Removed Records: Formula from /xl/worksheets/sheet5.xml")
      const ptWs = wb.Sheets['PT'];
      if (ptWs) {
        ptWs['I4'] = { t: 'n', v: 125, f: 'ROUND(H4/12,0)' };
        ptWs['I5'] = { t: 'n', v: 167, f: 'ROUND(H5/12,0)' };
        ptWs['I6'] = { t: 'n', v: 208, f: 'ROUND(H6/12,0)' };
        ptWs['I8'] = { t: 'n', v: 175, f: 'ROUND(H8/12,0)' };
        ptWs['I9'] = { t: 'n', v: 208, f: 'ROUND(H9/12,0)' };
        ptWs['I11'] = { t: 'n', v: 208, f: 'ROUND(H11/12,0)' };

        for (let rowIdx = 1; rowIdx <= 45; rowIdx++) {
          ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].forEach((col) => {
            delete ptWs[`${col}${rowIdx}`];
          });
        }

        for (const cell in ptWs) {
          if (cell.startsWith('!')) continue;
          const c = ptWs[cell];
          if (c && c.f && (c.f.includes('[') || c.f.includes('_xlws') || c.f.includes('Table') || c.f.includes('#REF') || c.f.includes('#NAME'))) {
            delete ptWs[cell];
          }
        }
      }

      // 1. Build Monthly_Payroll_Ledger Sheet with Live Excel Formulas
      const wsLedger = {};
      const ledgerHeaders = [
        'Sr No', 'Employee Code', 'Employee Name', 'Department', 'Designation', 'Company', 'Location', 'State',
        'Bank Name', 'Account Number', 'IFSC Code', 'Days in Month', 'Absent Days', 'Payable Days',
        'Fixed Gross', 'Fixed Basic', 'Fixed HRA', 'Fixed Other Allowances',
        'Earned Basic', 'Earned HRA', 'Earned Other Allowances', 'Arrears', 'Bonus', 'Incentive', 'Gross Earnings',
        'PF Applicable', 'Employee PF', 'ESIC Applicable', 'Employee ESIC', 'Professional Tax (PT)',
        'Loan EMI', 'Other Deductions', 'Total Deductions', 'Net Salary',
        'Employer PF', 'Employer ESIC', 'Gratuity', 'Total Employer Cost', 'Total Monthly CTC', 'Annual CTC', 'Status',
        'Payment Mode', 'PAN Number', 'UAN Number'
      ];

      ledgerHeaders.forEach((h, colIdx) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
        wsLedger[cellRef] = { t: 's', v: h };
      });

      // Build Dedicated Bank_Disbursement Sheet
      const wsBank = {};
      const bankHeaders = [
        'Sr No', 'Employee Code', 'Beneficiary Name', 'Company', 'Branch / Location',
        'Bank Name', 'Account Number', 'IFSC Code', 'Payment Mode', 'Net Salary Payable (₹)',
        'PAN Number', 'Narration / Remarks'
      ];
      bankHeaders.forEach((h, colIdx) => {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
        wsBank[cellRef] = { t: 's', v: h };
      });

      employees.forEach((emp, index) => {
        const r = index + 2;
        const struct = (emp.salaryStructures && emp.salaryStructures[0]) || null;
        const fixedGross = Number(struct?.fixed_gross || emp.fixed_gross || 0);
        const fixedBasic = Math.round(fixedGross * 0.50);
        const fixedHra = Math.round(fixedBasic * 0.40);
        const fixedOther = Math.max(0, fixedGross - fixedBasic - fixedHra);
        const daysInMonth = 30;
        const absentDays = 0;
        const payableDays = daysInMonth - absentDays;

        const pfApplicable = struct ? Boolean(struct.pf_applicable) : Boolean(emp.pf_applicable);
        const pfCeiling = struct ? Boolean(struct.pf_ceiling) : Boolean(emp.pf_ceiling);
        const esicApplicable = struct ? Boolean(struct.esic_applicable) : Boolean(emp.esic_applicable);

        const basic = Math.round((fixedBasic / daysInMonth) * payableDays);
        const hra = Math.round((fixedHra / daysInMonth) * payableDays);
        const other = Math.round((fixedOther / daysInMonth) * payableDays);
        const grossEarnings = basic + hra + other;

        const pf = pfApplicable ? Math.round(Math.min(basic, pfCeiling ? 15000 : basic) * 0.12) : 0;
        const esi = esicApplicable && grossEarnings <= 21000 ? Math.ceil(grossEarnings * 0.0075) : 0;
        let pt = 0;
        if (struct ? struct.pt_applicable !== false : emp.pt_applicable !== false) {
          if (grossEarnings > 33333) pt = 208;
          else if (grossEarnings > 25000) pt = 167;
          else if (grossEarnings > 15000) pt = 125;
        }

        const totalDeductions = pf + esi + pt;
        const net = grossEarnings - totalDeductions;
        const pfEmployer = pfApplicable ? Math.round(Math.min(basic, pfCeiling ? 15000 : basic) * 0.13) : 0;
        const esiEmployer = esicApplicable && grossEarnings <= 21000 ? Math.ceil(grossEarnings * 0.0325) : 0;
        const gratuity = Math.round(basic * 0.0481);
        const totalEmployerCost = pfEmployer + esiEmployer + gratuity;
        const monthlyCtc = grossEarnings + totalEmployerCost;
        const annualCtc = monthlyCtc * 12;

        wsLedger[`A${r}`] = { t: 'n', v: index + 1 };
        wsLedger[`B${r}`] = { t: 's', v: emp.emp_code || '' };
        wsLedger[`C${r}`] = { t: 's', v: emp.name || '' };
        wsLedger[`D${r}`] = { t: 's', v: emp.department || 'Operations' };
        wsLedger[`E${r}`] = { t: 's', v: emp.designation || 'Staff' };
        wsLedger[`F${r}`] = { t: 's', v: emp.company?.name || 'BP Marketing' };
        wsLedger[`G${r}`] = { t: 's', v: emp.office?.city || emp.office?.name || 'Indore' };
        wsLedger[`H${r}`] = { t: 's', v: struct?.state || emp.office?.state || 'MP' };
        const bankName = emp.bank_name || emp.bankName || '—';
        const bankAccount = emp.bank_account_number || emp.bank_account_no || emp.accountNumber || '—';
        const ifsc = emp.ifsc_code || emp.bank_ifsc || emp.ifscCode || '—';
        const paymentMode = emp.payment_mode || 'Bank Transfer';
        const panNumber = emp.pan_number || '—';
        const uanNumber = emp.uan || '—';

        wsLedger[`I${r}`] = { t: 's', v: String(bankName) };
        wsLedger[`J${r}`] = { t: 's', v: String(bankAccount) };
        wsLedger[`K${r}`] = { t: 's', v: String(ifsc) };
        wsLedger[`L${r}`] = { t: 'n', v: daysInMonth };
        wsLedger[`M${r}`] = { t: 'n', v: absentDays };
        wsLedger[`N${r}`] = { t: 'n', f: `L${r}-M${r}`, v: payableDays };
        wsLedger[`O${r}`] = { t: 'n', v: fixedGross };
        wsLedger[`P${r}`] = { t: 'n', f: `ROUND(O${r}*0.5,0)`, v: fixedBasic };
        wsLedger[`Q${r}`] = { t: 'n', f: `ROUND(P${r}*0.4,0)`, v: fixedHra };
        wsLedger[`R${r}`] = { t: 'n', f: `MAX(0,O${r}-P${r}-Q${r})`, v: fixedOther };
        wsLedger[`S${r}`] = { t: 'n', f: `ROUND((P${r}/L${r})*N${r},0)`, v: basic };
        wsLedger[`T${r}`] = { t: 'n', f: `ROUND((Q${r}/L${r})*N${r},0)`, v: hra };
        wsLedger[`U${r}`] = { t: 'n', f: `ROUND((R${r}/L${r})*N${r},0)`, v: other };
        wsLedger[`V${r}`] = { t: 'n', v: 0 };
        wsLedger[`W${r}`] = { t: 'n', v: 0 };
        wsLedger[`X${r}`] = { t: 'n', v: 0 };
        wsLedger[`Y${r}`] = { t: 'n', f: `SUM(S${r}:X${r})`, v: grossEarnings };
        wsLedger[`Z${r}`] = { t: 's', v: pfApplicable ? 'Yes' : 'No' };
        wsLedger[`AA${r}`] = { t: 'n', f: `IF(Z${r}="Yes",ROUND(MIN(S${r},15000)*0.12,0),0)`, v: pf };
        wsLedger[`AB${r}`] = { t: 's', v: esicApplicable ? 'Yes' : 'No' };
        wsLedger[`AC${r}`] = { t: 'n', f: `IF(AB${r}="Yes",IF(Y${r}<=21000,ROUND(Y${r}*0.0075,0),0),0)`, v: esi };
        wsLedger[`AD${r}`] = { t: 'n', v: pt };
        wsLedger[`AE${r}`] = { t: 'n', v: 0 };
        wsLedger[`AF${r}`] = { t: 'n', v: 0 };
        wsLedger[`AG${r}`] = { t: 'n', f: `SUM(AA${r},AC${r},AD${r},AE${r},AF${r})`, v: totalDeductions };
        wsLedger[`AH${r}`] = { t: 'n', f: `Y${r}-AG${r}`, v: net };
        wsLedger[`AI${r}`] = { t: 'n', f: `IF(Z${r}="Yes",ROUND(MIN(S${r},15000)*0.13,0),0)`, v: pfEmployer };
        wsLedger[`AJ${r}`] = { t: 'n', f: `IF(AB${r}="Yes",IF(Y${r}<=21000,ROUND(Y${r}*0.0325,0),0),0)`, v: esiEmployer };
        wsLedger[`AK${r}`] = { t: 'n', f: `ROUND(S${r}*0.0481,0)`, v: gratuity };
        wsLedger[`AL${r}`] = { t: 'n', f: `SUM(AI${r}:AK${r})`, v: totalEmployerCost };
        wsLedger[`AM${r}`] = { t: 'n', f: `Y${r}+AL${r}`, v: monthlyCtc };
        wsLedger[`AN${r}`] = { t: 'n', f: `AM${r}*12`, v: annualCtc };
        wsLedger[`AO${r}`] = { t: 's', v: 'Verified' };
        wsLedger[`AP${r}`] = { t: 's', v: String(paymentMode) };
        wsLedger[`AQ${r}`] = { t: 's', v: String(panNumber) };
        wsLedger[`AR${r}`] = { t: 's', v: String(uanNumber) };

        // Populate Bank_Disbursement row
        wsBank[`A${r}`] = { t: 'n', v: index + 1 };
        wsBank[`B${r}`] = { t: 's', v: String(emp.emp_code || '') };
        wsBank[`C${r}`] = { t: 's', v: String(emp.name || '') };
        wsBank[`D${r}`] = { t: 's', v: String(emp.company?.name || 'BP Marketing') };
        wsBank[`E${r}`] = { t: 's', v: String(emp.office?.city || emp.office?.name || 'Indore') };
        wsBank[`F${r}`] = { t: 's', v: String(bankName) };
        wsBank[`G${r}`] = { t: 's', v: String(bankAccount) };
        wsBank[`H${r}`] = { t: 's', v: String(ifsc) };
        wsBank[`I${r}`] = { t: 's', v: String(paymentMode) };
        wsBank[`J${r}`] = { t: 'n', f: `'Monthly_Payroll_Ledger'!AH${r}`, v: net };
        wsBank[`K${r}`] = { t: 's', v: String(panNumber) };
        wsBank[`L${r}`] = { t: 's', v: 'Salary Disbursement' };
      });

      const lastRow = employees.length + 1;
      const totRow = lastRow + 1;

      // Summary Row for Ledger
      wsLedger[`A${totRow}`] = { t: 's', v: 'TOTAL' };
      ['O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'AA', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN'].forEach(col => {
        wsLedger[`${col}${totRow}`] = { t: 'n', f: `SUM(${col}2:${col}${lastRow})` };
      });
      wsLedger['!ref'] = `A1:AR${totRow}`;

      // Summary Row & Column Widths for Bank_Disbursement
      wsBank[`A${totRow}`] = { t: 's', v: 'TOTAL' };
      wsBank[`J${totRow}`] = { t: 'n', f: `SUM(J2:J${lastRow})` };
      wsBank['!ref'] = `A1:L${totRow}`;
      wsBank['!cols'] = [
        { wch: 8 }, { wch: 15 }, { wch: 25 }, { wch: 22 }, { wch: 20 },
        { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 16 }, { wch: 22 },
        { wch: 15 }, { wch: 30 }
      ];

      // 2. Populate Sheet 2: CTC_Calculator
      if (wb.Sheets['CTC_Calculator']) {
        const calcWs = wb.Sheets['CTC_Calculator'];
        employees.forEach((emp, idx) => {
          const r = idx + 4;
          const struct = (emp.salaryStructures && emp.salaryStructures[0]) || null;
          const fixedGross = Number(struct?.fixed_gross || emp.fixed_gross || 0);
          const annualAmount = fixedGross * 12;

          calcWs[`A${r}`] = { t: 'n', v: idx + 1 };
          calcWs[`B${r}`] = { t: 's', v: String(emp.emp_code || '') };
          calcWs[`C${r}`] = { t: 's', v: String(emp.name || '') };
          calcWs[`D${r}`] = { t: 's', v: String(emp.designation || 'Staff') };
          calcWs[`E${r}`] = { t: 's', v: String(emp.office?.city || emp.office?.name || 'Indore') };
          calcWs[`F${r}`] = { t: 's', v: String(emp.company?.name || 'BP Marketing') };
          calcWs[`G${r}`] = { t: 's', v: String(struct?.state || emp.office?.state || 'MP') };
          calcWs[`H${r}`] = { t: 's', v: String(struct?.wages_category || 'Skilled') };
          calcWs[`I${r}`] = { t: 'n', f: `IF(OR($G${r}="",$H${r}=""),0,SUMPRODUCT(MAX(('Minimum Wages'!$A$2:$A$300=$G${r})*('Minimum Wages'!$B$2:$B$300=$H${r})*'Minimum Wages'!$C$2:$C$300)))` };
          calcWs[`J${r}`] = { t: 's', v: 'CTC' };
          calcWs[`K${r}`] = { t: 'n', v: annualAmount };
          calcWs[`L${r}`] = { t: 'n', f: `IF($K${r}="","",$K${r}/12)` };
          calcWs[`M${r}`] = { t: 'n', v: 0.50 };
          calcWs[`N${r}`] = { t: 'n', v: 0.40 };
          calcWs[`O${r}`] = { t: 'n', v: 0.13 };
          calcWs[`P${r}`] = { t: 'n', v: 0.12 };
          calcWs[`Q${r}`] = { t: 's', v: (struct ? struct.pf_applicable : emp.pf_applicable) ? 'Yes' : 'No' };
          calcWs[`R${r}`] = { t: 'n', v: 25000 };
          calcWs[`S${r}`] = { t: 'n', v: 0.0481 };
          calcWs[`T${r}`] = { t: 's', v: 'Yes' };
          calcWs[`U${r}`] = { t: 'n', v: 0.0833 };
          calcWs[`V${r}`] = { t: 's', v: (struct ? struct.esic_applicable : emp.esic_applicable) ? 'Yes' : 'No' };
          calcWs[`W${r}`] = { t: 's', v: 'Basic' };
          calcWs[`X${r}`] = { t: 'n', v: 0.0325 };
          calcWs[`Y${r}`] = { t: 'n', v: 0.0075 };
          calcWs[`Z${r}`] = { t: 'n', v: 21000 };
          calcWs[`AA${r}`] = { t: 'n', f: `CC${r}` };
          calcWs[`AB${r}`] = { t: 'n', v: 0 };
          calcWs[`AC${r}`] = { t: 'n', v: 0 };
          calcWs[`AD${r}`] = { t: 'n', v: 0 };
          calcWs[`AE${r}`] = { t: 'n', v: 0 };
          calcWs[`AF${r}`] = { t: 'n', v: 0 };
          calcWs[`AG${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",IF($J${r}="CTC",$K${r},IF($J${r}="Gross",Solver!$AH${r},IF($J${r}="Net Take Home",Solver!$BH${r},""))))` };
          calcWs[`AH${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",Solver!$F${r}*$O${r})` };
          calcWs[`AI${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",Solver!$G${r}*$X${r})` };
          calcWs[`AJ${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AN${r}*$S${r})` };
          calcWs[`AK${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",IF($AN${r}/12>21000,0,MAX(7000,$I${r})*12*Solver!$C${r}))` };
          calcWs[`AL${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",IF($AN${r}/12>21000,$AN${r}*Solver!$C${r},0))` };
          calcWs[`AM${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AG${r}-$AH${r}-$AI${r}-$AJ${r}-$AK${r}-$AL${r})` };
          calcWs[`AN${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",MAX($AG${r}*$M${r},$I${r}*12))` };
          calcWs[`AO${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",MAX(0,MIN($AN${r}*$N${r},ROUND($AM${r}-$AN${r},2))))` };
          calcWs[`AP${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",MAX(0,MIN($AF${r},ROUND($AM${r}-$AN${r}-$AO${r},2))))` };
          calcWs[`AQ${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",ROUND($AM${r}-$AN${r}-$AO${r}-$AP${r},2))` };
          calcWs[`AR${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AM${r})` };
          calcWs[`AS${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",Solver!$F${r}*$P${r})` };
          calcWs[`AT${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",Solver!$G${r}*$Y${r})` };
          calcWs[`AU${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AA${r}*12)` };
          calcWs[`AV${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AB${r}*12)` };
          calcWs[`AW${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AC${r}*12)` };
          calcWs[`AX${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AD${r}*12)` };
          calcWs[`AY${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AE${r}*12)` };
          calcWs[`AZ${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",SUM($AS${r}:$AY${r}))` };
          calcWs[`BA${r}`] = { t: 'n', f: `IF(OR($J${r}="",$K${r}=""),"",$AR${r}-$AZ${r})` };
          calcWs[`BB${r}`] = { t: 'n', f: `IF(AG${r}="","",AG${r}/12)` };
          calcWs[`BC${r}`] = { t: 'n', f: `IF(AH${r}="","",AH${r}/12)` };
          calcWs[`BD${r}`] = { t: 'n', f: `IF(AI${r}="","",AI${r}/12)` };
          calcWs[`BE${r}`] = { t: 'n', f: `IF(AJ${r}="","",AJ${r}/12)` };
          calcWs[`BF${r}`] = { t: 'n', f: `IF(AK${r}="","",AK${r}/12)` };
          calcWs[`BG${r}`] = { t: 'n', f: `IF(AL${r}="","",AL${r}/12)` };
          calcWs[`BH${r}`] = { t: 'n', f: `IF(AM${r}="","",AM${r}/12)` };
          calcWs[`BI${r}`] = { t: 'n', f: `IF(AN${r}="","",AN${r}/12)` };
          calcWs[`BJ${r}`] = { t: 'n', f: `IF(AO${r}="","",AO${r}/12)` };
          calcWs[`BK${r}`] = { t: 'n', f: `IF(AP${r}="","",AP${r}/12)` };
          calcWs[`BL${r}`] = { t: 'n', f: `IF(AQ${r}="","",AQ${r}/12)` };
          calcWs[`BM${r}`] = { t: 'n', f: `IF(AR${r}="","",AR${r}/12)` };
          calcWs[`BN${r}`] = { t: 'n', f: `IF(AS${r}="","",AS${r}/12)` };
          calcWs[`BO${r}`] = { t: 'n', f: `IF(AT${r}="","",AT${r}/12)` };
          calcWs[`BP${r}`] = { t: 'n', f: `IF(AU${r}="","",AU${r}/12)` };
          calcWs[`BQ${r}`] = { t: 'n', f: `IF(AV${r}="","",AV${r}/12)` };
          calcWs[`BR${r}`] = { t: 'n', f: `IF(AW${r}="","",AW${r}/12)` };
          calcWs[`BS${r}`] = { t: 'n', f: `IF(AX${r}="","",AX${r}/12)` };
          calcWs[`BT${r}`] = { t: 'n', f: `IF(AY${r}="","",AY${r}/12)` };
          calcWs[`BU${r}`] = { t: 'n', f: `IF(AZ${r}="","",AZ${r}/12)` };
          calcWs[`BV${r}`] = { t: 'n', f: `IF(BA${r}="","",BA${r}/12)` };
          calcWs[`BW${r}`] = { t: 's', f: `IF(OR($J${r}="",$K${r}=""),"",IF($I${r}*12>$AG${r}*$M${r},"Minimum Wage","% of CTC"))` };
          calcWs[`BX${r}`] = { t: 's', f: `IF(OR($J${r}="",$K${r}=""),"",IF(Solver!$H${r}<>"OK","NOT CONVERGED",IF(AND(ABS($AM${r}+$AH${r}+$AI${r}+$AJ${r}+$AK${r}+$AL${r}-$AG${r})<0.01,OR($J${r}="CTC",AND($J${r}="Gross",ABS($AM${r}-$K${r})<1),AND($J${r}="Net Take Home",ABS($BA${r}-$K${r})<1))),"OK","CHECK")))` };
          calcWs[`BZ${r}`] = { t: 's', v: (struct?.state || emp.office?.state) === 'MP' ? 'Madhya Pradesh' : (struct?.state || emp.office?.state || 'Madhya Pradesh') };
          calcWs[`CA${r}`] = { t: 's', v: emp.gender || 'All' };
          calcWs[`CB${r}`] = { t: 's', f: `IF($BZ${r}="","",IFERROR(INDEX(PT!$D$3:$D$42,MATCH($BZ${r},PT!$B$3:$B$42,0)),IFERROR(INDEX(PT!$D$3:$D$42,MATCH($BZ${r},PT!$C$3:$C$42,0)),"No")))` };
          calcWs[`CC${r}`] = { t: 'n', f: `IFERROR(IF($BH${r}="","",IF(OR($BZ${r}="",$CA${r}="",$CB${r}=""),0,IFERROR(INDEX(PT!$I$3:$I$42,MATCH(1,INDEX((PT!$X$3:$X$42=$BZ${r})*(PT!$Y$3:$Y$42=$CB${r})*((PT!$E$3:$E$42=$CA${r})+(PT!$E$3:$E$42="All")>0)*(PT!$F$3:$F$42<=$BH${r})*(((ISNUMBER(PT!$G$3:$G$42))*(PT!$G$3:$G$42>=$BH${r}))+(PT!$G$3:$G$42="& Above")>0),0),0)),0))),0)` };
          calcWs[`CD${r}`] = { t: 'n', v: fixedGross };
          delete calcWs[`CD${r}`].f;
          calcWs[`CE${r}`] = { t: 'n', f: `BV${r}-CD${r}` };
        });

        // Clean empty rows in CTC_Calculator beyond actual employees
        const maxCalcRow = employees.length + 3;
        for (const cell in calcWs) {
          if (cell.startsWith('!')) continue;
          const match = cell.match(/[0-9]+/);
          if (match && parseInt(match[0], 10) > maxCalcRow) {
            delete calcWs[cell];
          }
        }
        calcWs['!ref'] = `A1:CE${maxCalcRow}`;
      }

      // 3. Populate Sheet 3: Solver (Full 60-column Dynamic Calculations)
      if (wb.Sheets['Solver']) {
        const solverWs = wb.Sheets['Solver'];
        const grossCols = [
          'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH'
        ];
        const netCols = [
          'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH'
        ];

        employees.forEach((emp, idx) => {
          const r = idx + 4;
          solverWs[`A${r}`] = { t: 'n', f: `IF(CTC_Calculator!$A${r}="","",CTC_Calculator!$A${r})` };
          solverWs[`B${r}`] = { t: 's', f: `IF(CTC_Calculator!$B${r}="","",CTC_Calculator!$B${r})` };
          solverWs[`C${r}`] = { t: 'n', f: `IF(CTC_Calculator!$T${r}="Yes",CTC_Calculator!$U${r},0)` };
          solverWs[`D${r}`] = { t: 'n', f: `IF(CTC_Calculator!$Q${r}="Yes",IF(CTC_Calculator!$R${r}>0,CTC_Calculator!$R${r}*12,1000000000000000),0)` };
          solverWs[`E${r}`] = { t: 'n', f: `IF(CTC_Calculator!$V${r}="Yes",IF(CTC_Calculator!$Z${r}>0,CTC_Calculator!$Z${r}*12,1000000000000000),0)` };
          solverWs[`F${r}`] = { t: 'n', f: `IF(OR(CTC_Calculator!$J${r}="",CTC_Calculator!$K${r}=""),"",MIN(CTC_Calculator!$AN${r},$D${r}))` };
          solverWs[`G${r}`] = { t: 'n', f: `IF(OR(CTC_Calculator!$J${r}="",CTC_Calculator!$K${r}=""),"",IF(CTC_Calculator!$V${r}="No",0,IF(CTC_Calculator!$W${r}="Basic",MIN(CTC_Calculator!$AN${r},$E${r}),MIN((CTC_Calculator!$AG${r}-CTC_Calculator!$AH${r}-CTC_Calculator!$AJ${r}-CTC_Calculator!$AK${r}-CTC_Calculator!$AL${r})/(1+CTC_Calculator!$X${r}),$E${r}))))` };
          solverWs[`H${r}`] = { t: 's', f: `IF(OR(CTC_Calculator!$J${r}="",CTC_Calculator!$K${r}=""),"",IF(CTC_Calculator!$J${r}="CTC","OK",IF(CTC_Calculator!$J${r}="Gross",IF(ABS(AH${r}-AG${r})<0.01,"OK","NOT CONVERGED"),IF(ABS(BH${r}-BG${r})<0.01,"OK","NOT CONVERGED"))))` };

          // Gross basis iterations 0..25 (Cols I to AH)
          solverWs[`I${r}`] = { t: 'n', f: `IF(OR(CTC_Calculator!$A${r}="",CTC_Calculator!$K${r}=""),"",CTC_Calculator!$K${r})` };
          for (let c = 1; c < grossCols.length; c++) {
            const col = grossCols[c];
            const prevCol = grossCols[c - 1];
            solverWs[`${col}${r}`] = {
              t: 'n',
              f: `IF(OR(CTC_Calculator!$A${r}="",CTC_Calculator!$K${r}=""),"",CTC_Calculator!$K${r}+CTC_Calculator!$O${r}*MIN(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12),$D${r})+CTC_Calculator!$S${r}*MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)+IF(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)/12>21000,0,MAX(7000,CTC_Calculator!$I${r})*12*$C${r})+IF(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)/12>21000,MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)*$C${r},0)+CTC_Calculator!$X${r}*IF(CTC_Calculator!$V${r}="No",0,IF(CTC_Calculator!$W${r}="Basic",MIN(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12),$E${r}),MIN(CTC_Calculator!$K${r},$E${r}))))`
            };
          }

          // Net take home basis iterations 0..25 (Cols AI to BH)
          solverWs[`AI${r}`] = { t: 'n', f: `IF(OR(CTC_Calculator!$A${r}="",CTC_Calculator!$K${r}=""),"",CTC_Calculator!$K${r})` };
          for (let c = 1; c < netCols.length; c++) {
            const col = netCols[c];
            const prevCol = netCols[c - 1];
            solverWs[`${col}${r}`] = {
              t: 'n',
              f: `IF(OR(CTC_Calculator!$A${r}="",CTC_Calculator!$K${r}=""),"",CTC_Calculator!$K${r}+(CTC_Calculator!$AA${r}+CTC_Calculator!$AB${r}+CTC_Calculator!$AC${r}+CTC_Calculator!$AD${r}+CTC_Calculator!$AE${r})*12+(CTC_Calculator!$P${r}+CTC_Calculator!$O${r})*MIN(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12),$D${r})+CTC_Calculator!$S${r}*MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)+IF(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)/12>21000,MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)*$C${r},0)+(CTC_Calculator!$Y${r}+CTC_Calculator!$X${r})*IF(CTC_Calculator!$V${r}="No",0,IF(CTC_Calculator!$W${r}="Basic",MIN(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12),$E${r}),MIN((${prevCol}${r}-CTC_Calculator!$O${r}*MIN(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12),$D${r})-CTC_Calculator!$S${r}*MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)-IF(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)/12>21000,0,MAX(7000,CTC_Calculator!$I${r})*12*$C${r})-IF(MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)/12>21000,MAX(CTC_Calculator!$M${r}*${prevCol}${r},CTC_Calculator!$I${r}*12)*$C${r},0))/(1+CTC_Calculator!$X${r}),$E${r}))))`
            };
          }
        });

        // Clean empty rows in Solver beyond actual employees
        const maxCalcRow = employees.length + 3;
        for (const cell in solverWs) {
          if (cell.startsWith('!')) continue;
          const match = cell.match(/[0-9]+/);
          if (match && parseInt(match[0], 10) > maxCalcRow) {
            delete solverWs[cell];
          }
        }
        solverWs['!ref'] = `A1:BH${maxCalcRow}`;
      }

      // Reorder sheets with Monthly_Payroll_Ledger & Bank_Disbursement first
      wb.SheetNames = ['Monthly_Payroll_Ledger', 'Bank_Disbursement', 'CTC_Calculator', 'Solver', 'Minimum Wages', 'PT'];
      wb.Sheets['Monthly_Payroll_Ledger'] = wsLedger;
      wb.Sheets['Bank_Disbursement'] = wsBank;

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Company_CTC_Structure_Master.xlsx"');
      return res.send(buffer);
    } catch (err) {
      logger.error('Error exporting salary structures excel:', err);
      next(err);
    }
  }
}

module.exports = new SalaryStructureController();
