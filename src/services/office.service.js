const { Office, Company, Employee, AttendanceRecord, sequelize } = require('../models');
const { Op } = require('sequelize');

class OfficeService {
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
          attributes: ['id', 'name'],
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
          attributes: ['id', 'name'],
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

    // Check unique code constraint
    if (data.code) {
      const existing = await Office.findOne({ where: { code: data.code } });
      if (existing) {
        const error = new Error(`Location code "${data.code}" is already in use`);
        error.statusCode = 409;
        throw error;
      }
    }

    const office = await Office.create(data);
    return Office.findByPk(office.id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
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
    if (data.code && data.code !== office.code) {
      const existing = await Office.findOne({ where: { code: data.code } });
      if (existing) {
        const error = new Error(`Location code "${data.code}" is already in use`);
        error.statusCode = 409;
        throw error;
      }
    }

    await office.update(data);
    return Office.findByPk(id, {
      include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
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