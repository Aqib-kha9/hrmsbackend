const { Letter, Employee, AuthorisedSignatory } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');

class LetterService {
  async getLetters(employeeId, { page = 1, limit = PAGINATION.DEFAULT_LIMIT, type, status } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = { employee_id: employeeId };
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;

    const { rows, count } = await Letter.findAndCountAll({
      where: whereClause,
      order: [['issued_date', 'DESC']],
      limit,
      offset,
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async getLetterById(letterId, employeeId) {
    const letter = await Letter.findByPk(letterId);
    if (!letter) throw new AppError('Letter not found', 404);

    // Non-admin can only view their own letters
    const employee = await Employee.findByPk(employeeId);
    if (employee.role !== 'admin' && employee.role !== 'hr' && letter.employee_id !== employeeId) {
      throw new AppError('Access denied', 403);
    }

    return letter;
  }

  async acknowledgeLetter(letterId, employeeId) {
    const letter = await Letter.findOne({
      where: { id: letterId, employee_id: employeeId },
    });

    if (!letter) throw new AppError('Letter not found', 404);
    if (letter.acknowledged_at) throw new AppError('Letter already acknowledged', 400);

    await letter.update({ acknowledged_at: new Date() });
    logger.info(`Letter ${letterId} acknowledged by employee ${employeeId}`);
    return letter;
  }

  async getAllLetters({ page = 1, limit = PAGINATION.DEFAULT_LIMIT, type, status, search } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = {};
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { candidate_name: { [Op.like]: `%${search}%` } },
        { candidate_email: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await Letter.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Employee,
          as: 'issuedTo',
          attributes: ['id', 'emp_code', 'name', 'department', 'designation', 'email'],
          required: false,
        },
        {
          model: AuthorisedSignatory,
          as: 'signatory',
          attributes: ['id', 'name', 'designation', 'signature_url'],
          required: false,
        },
        {
          model: Employee,
          as: 'issuedBy',
          attributes: ['id', 'emp_code', 'name'],
          required: false,
        },
      ],
      order: [['issued_date', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async issueLetter(letterData, issuedBy) {
    const letter = await Letter.create({
      ...letterData,
      issued_by: issuedBy,
      issued_date: letterData.issued_date || new Date(),
      status: letterData.status || 'issued',
    });

    const targetDesc = letter.employee_id
      ? `employee ${letter.employee_id}`
      : `candidate ${letter.candidate_name || letter.candidate_email}`;
    logger.info(`Letter issued to ${targetDesc} by ${issuedBy}`);
    return letter;
  }

  async updateLetter(letterId, updateData) {
    const letter = await Letter.findByPk(letterId);
    if (!letter) throw new AppError('Letter not found', 404);

    await letter.update(updateData);
    return letter;
  }

  async deleteLetter(letterId) {
    const letter = await Letter.findByPk(letterId);
    if (!letter) throw new AppError('Letter not found', 404);

    await letter.destroy();
    logger.info(`Letter ${letterId} deleted`);
    return true;
  }
}

module.exports = new LetterService();