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
   * Download company-wide 83-column spreadsheet matching client format
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

      const exportData = [];

      employees.forEach((emp, index) => {
        const struct = (emp.salaryStructures && emp.salaryStructures[0]) || null;
        const empState = struct?.state || emp.office?.state || 'MP';
        const empCat = struct?.wages_category || 'Skilled';

        const matchedMW = minWages.find(
          (m) => m.state.toUpperCase() === empState.toUpperCase() && m.wages_category.toUpperCase() === empCat.toUpperCase()
        );
        const minWageMonthly = matchedMW ? Number(matchedMW.monthly_wage) : Number(struct?.minimum_wage || 0);

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
          currentTakeHome: Number(struct?.current_take_home || 0),
          customPtSlabs: ptSlabs,
        });

        exportData.push({
          'Sr No': index + 1,
          'Employee Code': emp.emp_code,
          'Employee Name': emp.name,
          Designation: emp.designation,
          Location: emp.office?.city || emp.office?.name || 'Indore',
          Company: emp.company?.name || 'BP Marketing',
          State: empState,
          'Wages Category': empCat,
          'Monthly Minimum Wages (₹)': minWageMonthly,
          'Calculation Basis': struct?.calculation_basis || 'CTC',
          'Amount (Annual ₹)': calc.annual.ctc,
          'Amount (Monthly ₹)': calc.monthly.ctc,
          'Basic %': struct?.basic_pct || 0.50,
          'HRA %': struct?.hra_pct || 0.40,
          'Employer PF %': 0.13,
          'Employee PF %': 0.12,
          'PF Applicable?': struct?.pf_applicable ? 'Yes' : 'No',
          'PF Wage Limit (₹/month)': struct?.pf_wage_limit || 25000,
          'Gratuity %': 0.0481,
          'Bonus Applicable?': struct?.bonus_applicable ? 'Yes' : 'No',
          'Bonus %': 0.0833,
          'ESIC Applicable?': struct?.esic_applicable ? 'Yes' : 'No',
          'ESIC Calculation Base': struct?.esic_calc_base || 'Basic',
          'Employer ESIC %': 0.0325,
          'Employee ESIC %': 0.0075,
          'ESIC Wage Limit': 21000,
          'Professional Tax (Monthly ₹)': calc.monthly.pt,
          'Annual CTC (₹)': calc.annual.ctc,
          'Annual Gross Salary (₹)': calc.annual.gross,
          'Annual Basic Salary (₹)': calc.annual.basic,
          'Annual HRA (₹)': calc.annual.hra,
          'Annual Special Allowance (₹)': calc.annual.specialAllowance,
          'Annual Employer PF (₹)': calc.annual.employerPf,
          'Annual Employer ESIC (₹)': calc.annual.employerEsic,
          'Annual Gratuity (₹)': calc.annual.gratuity,
          'Annual Statutory Bonus (₹)': calc.annual.statutoryBonus,
          'Annual Exgratia Bonus (₹)': calc.annual.exgratiaBonus,
          'Annual Employee PF (₹)': calc.annual.employeePf,
          'Annual Employee ESIC (₹)': calc.annual.employeeEsic,
          'Annual Professional Tax (₹)': calc.annual.pt,
          'Annual Total Deductions (₹)': calc.annual.totalDeductions,
          'Annual Net Take-Home (₹)': calc.annual.netTakeHome,
          'Monthly Gross Salary (₹)': calc.monthly.gross,
          'Monthly Basic Salary (₹)': calc.monthly.basic,
          'Monthly HRA (₹)': calc.monthly.hra,
          'Monthly Special Allowance (₹)': calc.monthly.specialAllowance,
          'Monthly Net Take-Home (₹)': calc.monthly.netTakeHome,
          'Previous Take Home (₹)': Number(struct?.current_take_home || 0),
          'Difference in TH (₹)': calc.meta.differenceInTakeHome,
          'Basic Calculate on': calc.meta.basicCalculatedOn,
        });
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws, 'CTC_Roster');

      // Also append Minimum Wages and PT Slabs sheets
      const wsMW = XLSX.utils.json_to_sheet(minWages);
      XLSX.utils.book_append_sheet(wb, wsMW, 'Minimum_Wages');

      const wsPT = XLSX.utils.json_to_sheet(ptSlabs);
      XLSX.utils.book_append_sheet(wb, wsPT, 'PT_Slabs');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Company_CTC_Structure_Roster.xlsx"');
      return res.send(buffer);
    } catch (err) {
      logger.error('Error exporting salary structures excel:', err);
      next(err);
    }
  }
}

module.exports = new SalaryStructureController();
