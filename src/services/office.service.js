const { Office, Company, Employee, AttendanceRecord, sequelize } = require('../models');
const { Op } = require('sequelize');

function deriveCompanyLocationPrefix(company) {
  if (!company) return 'LOC';
  const name = (company.name || '').trim();
  if (/^bp\s*marketing/i.test(name)) return 'BPM';
  if (/^apaar\s*logistics/i.test(name)) return 'APR';
  if (/^ae\s*solutions/i.test(name)) return 'AES';
  if (/^pj\s*enterprises/i.test(name)) return 'PJE';
  if (company.code && company.code.trim().length >= 2) return company.code.trim().toUpperCase();

  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  } else if (words.length === 2) {
    return (words[0].slice(0, 2) + words[1][0]).toUpperCase();
  } else if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return 'LOC';
}

function deriveCityPrefix(city, name) {
  const target = (city && city.trim()) ? city.trim() : (name && name.trim()) ? name.trim() : '';
  if (!target) return 'LOC';

  const clean = target.replace(/[^a-zA-Z0-9\s]/g, '').trim().toUpperCase();
  const cityMap = {
    'INDORE': 'IND',
    'RATLAM': 'RTM',
    'UJJAIN': 'UJJ',
    'NOIDA': 'NOI',
    'GURGAON': 'GGN',
    'GURUGRAM': 'GGN',
    'MUMBAI': 'MUM',
    'BOMBAY': 'MUM',
    'DELHI': 'DEL',
    'NEW DELHI': 'DEL',
    'BANGALORE': 'BLR',
    'BENGALURU': 'BLR',
    'PUNE': 'PUN',
    'HYDERABAD': 'HYD',
    'CHENNAI': 'MAA',
    'KOLKATA': 'CCU',
    'AHMEDABAD': 'AMD',
    'JAIPUR': 'JAI',
    'BHOPAL': 'BPL',
    'GWALIOR': 'GWL',
    'JABALPUR': 'JBP',
    'LUCKNOW': 'LKO',
    'KANPUR': 'KNP',
    'CHANDIGARH': 'IXC',
  };
  if (cityMap[clean]) return cityMap[clean];

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
  }
  return clean.slice(0, 3).toUpperCase();
}

class OfficeService {
  /**
   * Auto-generate a clean, unique company-specific location code (e.g. BPM-IND, BPM-IND-02).
   */
  async generateOfficeCode({ company_id, city, name }) {
    let compPrefix = 'LOC';
    if (company_id) {
      const company = await Company.findByPk(company_id);
      if (company) {
        compPrefix = deriveCompanyLocationPrefix(company);
      }
    }
    const cityPrefix = deriveCityPrefix(city, name);
    const baseCode = `${compPrefix}-${cityPrefix}`;

    const existingExact = await Office.findOne({ where: { code: baseCode } });
    if (!existingExact) {
      return baseCode;
    }

    const existingSimilar = await Office.findAll({
      where: {
        code: {
          [Op.like]: `${baseCode}%`,
        },
      },
      attributes: ['code'],
    });

    const usedCodes = new Set(existingSimilar.map((o) => o.code));
    for (let i = 2; i <= 99; i++) {
      const candidate = `${baseCode}-${String(i).padStart(2, '0')}`;
      if (!usedCodes.has(candidate)) {
        return candidate;
      }
    }
    return `${baseCode}-${Date.now().toString().slice(-4)}`;
  }
  /**
   * List all offices with optional filters, search, pagination, and company info.
   * @param {Object} options
   * @param {string}  [options.search]     – search across name, code, city, state
   * @param {number}  [options.company_id] – filter by parent company
   * @param {string}  [options.city]
   * @param {string}  [options.state]
   * @param {boolean} [options.is_active]
   * @param {number}  [options.page=1]
   * @param {number}  [options.limit=20]
   * @returns {Object} { rows, count, pagination }
   */
  async getOffices({ search, company_id, city, state, is_active, page = 1, limit = 20 } = {}) {
    const where = {};

    if (company_id !== undefined) where.company_id = company_id;
    if (city) where.city = { [Op.like]: `%${city}%` };
    if (state) where.state = { [Op.like]: `%${state}%` };
    if (is_active !== undefined) where.is_active = is_active;

    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { code: { [Op.like]: `%${search}%` } },
        { city: { [Op.like]: `%${search}%` } },
        { state: { [Op.like]: `%${search}%` } },
      ];
    }

    const offset = (page - 1) * limit;

    const { rows, count } = await Office.findAndCountAll({
      where,
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'code', 'city', 'state'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    // Attach active_employee_count to each office row (Req 2.7: Total Active Employees)
    const officeIds = rows.map((o) => o.id);
    if (officeIds.length > 0) {
      const empCounts = await Employee.findAll({
        attributes: ['office_id', [sequelize.fn('COUNT', sequelize.col('Employee.id')), 'employee_count']],
        where: { office_id: { [Op.in]: officeIds }, status: 'active', role: { [Op.ne]: 'admin' } },
        group: ['office_id'],
        raw: true,
      });
      const countMap = {};
      empCounts.forEach((r) => { countMap[r.office_id] = parseInt(r.employee_count, 10); });
      rows.forEach((o) => {
        const activeCount = countMap[o.id] || 0;
        o.dataValues.active_employee_count = activeCount;
        o.dataValues.employee_count = activeCount;
      });
    } else {
      rows.forEach((o) => {
        o.dataValues.active_employee_count = 0;
        o.dataValues.employee_count = 0;
      });
    }

    return {
      rows,
      count,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        totalRecords: count,
      },
    };
  }

  /**
   * Get a single office by ID with company + employee count.
   */
  async getOfficeById(id) {
    const office = await Office.findByPk(id, {
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'code', 'city', 'state'],
        },
      ],
    });

    if (!office) {
      const error = new Error('Office not found');
      error.statusCode = 404;
      throw error;
    }

    // Attach active employee count (Req 2.7: Total Active Employees)
    const activeEmployeeCount = await Employee.count({
      where: { office_id: id, status: 'active', role: { [Op.ne]: 'admin' } },
    });
    const officeJson = office.toJSON();
    officeJson.active_employee_count = activeEmployeeCount;
    officeJson.employee_count = activeEmployeeCount;

    return officeJson;
  }

  /**
   * Create a new office location.
   */
  async createOffice(data) {
    // Verify the parent company exists
    const company = await Company.findByPk(data.company_id);
    if (!company) {
      const error = new Error('Parent company not found');
      error.statusCode = 404;
      throw error;
    }

    // Auto-generate unique code if not provided or blank
    if (!data.code || !String(data.code).trim()) {
      data.code = await this.generateOfficeCode({
        company_id: data.company_id,
        city: data.city,
        name: data.name,
      });
    } else {
      data.code = String(data.code).trim().toUpperCase();
      const existing = await Office.findOne({ where: { code: data.code } });
      if (existing) {
        const error = new Error(`Location code "${data.code}" is already in use`);
        error.statusCode = 409;
        throw error;
      }
    }

    const office = await Office.create(data);
    return Office.findByPk(office.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name', 'code', 'city', 'state'] }],
    });
  }

  /**
   * Update an existing office.
   */
  async updateOffice(id, data) {
    const office = await Office.findByPk(id);
    if (!office) {
      const error = new Error('Office not found');
      error.statusCode = 404;
      throw error;
    }

    // If changing company_id, verify the new company exists
    if (data.company_id && data.company_id !== office.company_id) {
      const company = await Company.findByPk(data.company_id);
      if (!company) {
        const error = new Error('Parent company not found');
        error.statusCode = 404;
        throw error;
      }
    }

    // Check unique code if changing
    if (data.code) {
      data.code = String(data.code).trim().toUpperCase();
      if (data.code !== office.code) {
        const existing = await Office.findOne({ where: { code: data.code } });
        if (existing) {
          const error = new Error(`Location code "${data.code}" is already in use`);
          error.statusCode = 409;
          throw error;
        }
      }
    }

    await office.update(data);
    return Office.findByPk(id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name', 'code', 'city', 'state'] }],
    });
  }

  /**
   * Soft-delete an office (paranoid model).
   * Prevents deletion if employees are still assigned.
   */
  async deleteOffice(id) {
    const office = await Office.findByPk(id);
    if (!office) {
      const error = new Error('Office not found');
      error.statusCode = 404;
      throw error;
    }

    const employeeCount = await Employee.count({ where: { office_id: id, role: { [Op.ne]: 'admin' } } });
    if (employeeCount > 0) {
      const error = new Error(
        `Cannot delete — ${employeeCount} employee(s) are still assigned to this location. Reassign them first.`
      );
      error.statusCode = 409;
      throw error;
    }

    await office.destroy(); // soft-delete (paranoid)
    return { deleted: true };
  }

  /**
   * Get aggregated stats for all offices — total count, active count, total employees.
   */
  async getOfficeStats() {
    const total = await Office.count();
    const active = await Office.count({ where: { is_active: true } });
    const inactive = total - active;

    // Total active employees across all offices (Req 2.7: show Total Active Employees)
    const totalActiveEmployees = await Employee.count({
      where: { office_id: { [Op.ne]: null }, status: 'active', role: { [Op.ne]: 'admin' } },
    });

    // Active employee count per office (Req 2.7)
    const perOffice = await Employee.findAll({
      attributes: [
        'office_id',
        [sequelize.fn('COUNT', sequelize.col('Employee.id')), 'employee_count'],
      ],
      where: { office_id: { [Op.ne]: null }, status: 'active', role: { [Op.ne]: 'admin' } },
      group: ['office_id'],
      raw: true,
    });

    // Map office → active employee count
    const employeeCountMap = {};
    perOffice.forEach((row) => {
      employeeCountMap[row.office_id] = parseInt(row.employee_count, 10);
    });

    return {
      total_offices: total,
      active_offices: active,
      inactive_offices: inactive,
      total_active_employees: totalActiveEmployees,
      total_employees: totalActiveEmployees,
      active_employee_count_by_office: employeeCountMap,
      employee_count_by_office: employeeCountMap,
    };
  }
}

module.exports = new OfficeService();