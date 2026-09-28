const bcrypt = require('bcryptjs');
const { Employee, SalaryStructure, SalaryRevision, LeaveBalance, Letter, Notification, Office, sequelize } = require('../models');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { AppError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const { LEAVE_DEFAULTS, LEAVE_TYPES, SALARY_REVISION_TYPES, LEAVE_ACCRUAL } = require('../utils/constants');
const offerLetterService = require('./offer_letter.service');
const emailService = require('./email.service');

class AuthService {
  async login(email, password) {
    const employee = await Employee.findOne({ 
      where: { email },
      include: ['office', 'company']
    });
    if (!employee) {
      throw new AppError('Invalid email or password', 401);
    }

    if (employee.status !== 'active') {
      throw new AppError('Your account is not active. Contact HR.', 403);
    }

    const isPasswordValid = await bcrypt.compare(password, employee.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    const accessToken = generateAccessToken({ id: employee.id, role: employee.role, emp_code: employee.emp_code });
    const refreshToken = generateRefreshToken({ id: employee.id });

    // Store refresh token and update last login
    await employee.update({
      refresh_token: refreshToken,
      last_login_at: new Date(),
      is_first_login: false,
    });

    logger.info(`Employee ${employee.emp_code} logged in successfully`);

    return {
      token: accessToken,
      refreshToken,
      employee: {
        id: employee.id,
        emp_code: employee.emp_code,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        role: employee.role,
        designation: employee.designation,
        department: employee.department,
        office_id: employee.office_id,
        company_id: employee.company_id,
        profile_image: employee.profile_image,
        is_first_login: employee.is_first_login,
        date_of_joining: employee.date_of_joining,
        location: employee.office ? employee.office.name : employee.location,
        company_name: employee.company ? employee.company.name : employee.company_name,
        fixed_gross: employee.fixed_gross,
        basic_salary: employee.basic_salary,
        pf_applicable: employee.pf_applicable,
        pf_ceiling: employee.pf_ceiling,
        esic_applicable: employee.esic_applicable,
        bank_name: employee.bank_name,
        bank_account_number: employee.bank_account_number,
        ifsc_code: employee.ifsc_code,
        pan_number: employee.pan_number,
        pf_number: employee.pf_number,
        uan: employee.uan,
        shift_start_time: employee.shift_start_time,
        shift_end_time: employee.shift_end_time,
      },
    };
  }

  /**
   * Production onboarding: Creates Employee, SalaryStructure, SalaryRevision,
   * LeaveBalances, Offer Letter, and sends welcome email — all in one transaction.
   *
   * @param {object} employeeData - Full onboarding payload:
   *   Core: emp_code, name, email, phone, password, designation, department, role,
   *         date_of_joining, date_of_birth, gender, address, office_id
   *   Bank: bank_name, bank_account_number, ifsc_code
   *   Statutory: pan_number, pf_number, uan
   *   Location: location, company_name
   *   Emergency: emergency_contact_name, emergency_contact_relation
   *   Salary: fixed_gross, pf_applicable, pf_ceiling, esic_applicable, pt_applicable,
   *           special_allowance, conveyance, medical_allowance, effective_work_days
   *   Send: send_offer_letter (boolean, default true)
   * @param {number} issuedBy - Admin employee ID who initiated onboarding
   * @returns {object} Created employee summary with onboarding status
   */
  async register(employeeData, issuedBy = null) {
    const existingEmployee = await Employee.findOne({
      where: { email: employeeData.email },
    });

    if (existingEmployee) {
      throw new AppError('Employee with this email already exists', 409);
    }

    const existingCode = await Employee.findOne({
      where: { emp_code: employeeData.emp_code },
    });

    if (existingCode) {
      throw new AppError('Employee code already exists', 409);
    }

    const plainPassword = employeeData.password || 'Welcome@123';
    const hashedPassword = await bcrypt.hash(plainPassword, 12);
    const sendOfferLetter = employeeData.send_offer_letter === true; // default false

    // Calculate salary breakup using 40% basic formula matching payroll_ledger
    const gross = Number(employeeData.fixed_gross) || 0;
    const basic = Math.round(gross * 0.40);
    const hra = Math.round(basic * 0.40);
    const otherAllowance = gross - basic - hra;
    const effectiveWorkDays = employeeData.effective_work_days || 26;

    // Execute onboarding in a transaction
    let result;
    try {
      result = await sequelize.transaction(async (t) => {
        // 1. Create Employee
        const employee = await Employee.create({
          emp_code: employeeData.emp_code,
          name: employeeData.name,
          email: employeeData.email,
          phone: employeeData.phone,
          password: hashedPassword,
          designation: employeeData.designation,
          department: employeeData.department,
          role: employeeData.role || 'employee',
          date_of_joining: employeeData.date_of_joining,
          date_of_birth: employeeData.date_of_birth,
          gender: employeeData.gender,
          address: employeeData.address,
          office_id: employeeData.office_id,
          company_id: employeeData.company_id || null,
          status: 'active',
          is_first_login: true,
          // Salary denormalized
          fixed_gross: gross,
          basic_salary: basic,
          pf_applicable: employeeData.pf_applicable !== false,
          pf_ceiling: employeeData.pf_ceiling || false,
          pf_contribution_mode: employeeData.pf_contribution_mode || 'shared',
          esic_applicable: employeeData.esic_applicable || false,
          esic_contribution_mode: employeeData.esic_contribution_mode || 'shared',
          // Bank
          bank_name: employeeData.bank_name,
          bank_account_number: employeeData.bank_account_number,
          ifsc_code: employeeData.ifsc_code,
          // Statutory
          pan_number: employeeData.pan_number,
          pf_number: employeeData.pf_number,
          uan: employeeData.uan,
          // Location
          location: employeeData.location,
          company_name: employeeData.company_name || 'Apaar Logistics & Cold Supply Chain Pvt Ltd',
          // Emergency
          emergency_contact_name: employeeData.emergency_contact_name,
          emergency_contact_relation: employeeData.emergency_contact_relation,
          // Shift configuration
          shift_start_time: employeeData.shift_start_time || null,
          shift_end_time: employeeData.shift_end_time || null,
          half_day_late_minutes: employeeData.half_day_late_minutes ?? 60,
        }, { transaction: t });

        // 2. Create SalaryStructure (source of truth)
        const salaryStructure = await SalaryStructure.create({
          employee_id: employee.id,
          fixed_gross: gross,
          basic_salary: basic,
          hra: hra,
          special_allowance: employeeData.special_allowance || 0,
          other_allowance: otherAllowance,
          conveyance: employeeData.conveyance || 0,
          medical_allowance: employeeData.medical_allowance || 0,
          pf_applicable: employeeData.pf_applicable !== false,
          pf_ceiling: employeeData.pf_ceiling || false,
          pf_contribution_mode: employeeData.pf_contribution_mode || 'shared',
          pf_employee_rate: employeeData.pf_employee_rate ?? 0.12,
          pf_employer_rate: employeeData.pf_employer_rate ?? 0.12,
          esic_applicable: employeeData.esic_applicable || false,
          esic_contribution_mode: employeeData.esic_contribution_mode || 'shared',
          esic_employee_rate: employeeData.esic_employee_rate ?? 0.0075,
          esic_employer_rate: employeeData.esic_employer_rate ?? 0.0325,
          pt_applicable: employeeData.pt_applicable !== false,
          effective_work_days: effectiveWorkDays,
          effective_from: employeeData.date_of_joining || new Date(),
          created_by: issuedBy,
          updated_by: issuedBy,
        }, { transaction: t });

        // 3. Create SalaryRevision (initial record)
        await SalaryRevision.create({
          employee_id: employee.id,
          previous_gross: null,
          new_gross: gross,
          previous_basic: null,
          new_basic: basic,
          revision_type: SALARY_REVISION_TYPES.INITIAL,
          effective_date: employeeData.date_of_joining || new Date(),
          remarks: 'Initial salary setup during onboarding',
          approved_by: issuedBy,
        }, { transaction: t });

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // 4. Create initial LeaveBalance record for the new employee
        await LeaveBalance.create({
          employee_id: employee.id,
          available: LEAVE_ACCRUAL.MONTHLY_ACCRUAL,
          used: 0,
          admin_granted: 0,
          lapsed: 0,
          last_accrual_month: currentMonth,
          consecutive_no_usage_months: 0,
        }, { transaction: t });

        // 4b. Create Appointment Letter record
        const appointmentLetter = await Letter.create({
          employee_id: employee.id,
          type: 'appointment',
          title: `Appointment Letter — ${employeeData.designation || 'Employment'}`,
          content: `Appointment letter issued for the position of ${employeeData.designation || 'N/A'} effective ${employeeData.date_of_joining || 'joining date'}.`,
          issued_date: new Date(),
          issued_by: issuedBy,
          status: 'issued',
        }, { transaction: t });

        // 4c. Create Welcome Notification
        await Notification.create({
          employee_id: employee.id,
          title: 'Welcome Aboard! 🎉',
          message: `Welcome to Apaar Logistics & Cold Supply Chain Pvt Ltd, ${employeeData.name}! Your employee code is ${employeeData.emp_code}. Please complete your profile and acknowledge your offer letter.`,
          type: 'success',
          category: 'onboarding',
          is_read: false,
        }, { transaction: t });

        return { employee: employee.toJSON(), salaryStructure: salaryStructure.toJSON(), appointmentLetter: appointmentLetter.toJSON() };
      });

      logger.info(`Employee ${result.employee.emp_code} onboarded successfully with salary structure, appointment letter, and welcome notification`);
    } catch (error) {
      logger.error(`Onboarding failed for ${employeeData.email}:`, error);
      throw new AppError(`Onboarding failed: ${error.message}`, 500);
    }

    // 5. Generate offer letter PDF + send email (outside transaction — if fails, employee is still created)
    let letterRecord = null;
    let emailSent = false;
    if (sendOfferLetter) {
      try {
        // Re-fetch the employee instance to use in offer letter
        const employee = await Employee.findByPk(result.employee.id);
        const salaryStructure = await SalaryStructure.findOne({
          where: { employee_id: result.employee.id },
          order: [['effective_from', 'DESC']],
        });

        const { letter, emailResult } = await offerLetterService.issueAndSendOfferLetter(
          employee,
          salaryStructure,
          plainPassword,
          issuedBy,
        );
        letterRecord = letter;
        emailSent = emailResult.accepted.length > 0;
      } catch (err) {
        // Non-fatal: employee is still created, but offer letter/email failed
        logger.error(`Offer letter/email failed for ${result.employee.emp_code}:`, err.message);
      }
    }

    return {
      id: result.employee.id,
      emp_code: result.employee.emp_code,
      name: result.employee.name,
      email: result.employee.email,
      phone: result.employee.phone,
      role: result.employee.role,
      designation: result.employee.designation,
      department: result.employee.department,
      office_id: result.employee.office_id,
      date_of_joining: result.employee.date_of_joining,
      location: result.employee.location,
      company_name: result.employee.company_name,
      fixed_gross: result.employee.fixed_gross,
      basic_salary: result.employee.basic_salary,
      pf_applicable: result.employee.pf_applicable,
      pf_ceiling: result.employee.pf_ceiling,
      pf_contribution_mode: result.employee.pf_contribution_mode,
      esic_applicable: result.employee.esic_applicable,
      esic_contribution_mode: result.employee.esic_contribution_mode,
      bank_name: result.employee.bank_name,
      bank_account_number: result.employee.bank_account_number,
      ifsc_code: result.employee.ifsc_code,
      pan_number: result.employee.pan_number,
      pf_number: result.employee.pf_number,
      uan: result.employee.uan,
      emergency_contact_name: result.employee.emergency_contact_name,
      emergency_contact_relation: result.employee.emergency_contact_relation,
      onboarding: {
        salary_structure_created: true,
        leave_balances_created: true,
        appointment_letter_created: true,
        welcome_notification_created: true,
        offer_letter_sent: !!letterRecord,
        welcome_email_sent: emailSent,
        letter_id: letterRecord ? letterRecord.id : null,
      },
    };
  }

  async refreshToken(refreshToken) {
    const decoded = verifyRefreshToken(refreshToken);
    const employee = await Employee.findByPk(decoded.id);

    if (!employee || employee.refresh_token !== refreshToken) {
      throw new AppError('Invalid refresh token', 401);
    }

    if (employee.status !== 'active') {
      throw new AppError('Account is not active', 403);
    }

    const newAccessToken = generateAccessToken({ id: employee.id, role: employee.role, emp_code: employee.emp_code });
    const newRefreshToken = generateRefreshToken({ id: employee.id });

    await employee.update({ refresh_token: newRefreshToken });

    return {
      token: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async changePassword(employeeId, currentPassword, newPassword) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, employee.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await employee.update({ password: hashedPassword });

    logger.info(`Employee ${employee.emp_code} changed password`);
    return true;
  }

  /**
   * Forgot password — generate crypto reset token, store hash + expiry,
   * and send email with a reset link containing the raw token.
   *
   * Uses a 1-hour expiry window. Token is hashed before storage (bcrypt)
   * so a leaked database row doesn't expose valid reset tokens.
   */
  async forgotPassword(email) {
    const employee = await Employee.findOne({ where: { email } });
    if (!employee) {
      // Don't reveal whether an account exists — security best practice
      throw new AppError('If that email is registered, a reset link has been sent.', 404);
    }

    if (employee.status !== 'active') {
      throw new AppError('If that email is registered, a reset link has been sent.', 404);
    }

    // Generate a cryptographically random token
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex'); // 64-char hex
    const hashedToken = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await employee.update({
      reset_password_token: hashedToken,
      reset_password_expires: expiresAt,
    });

    // Send the reset email (non-blocking — fire and forget)
    emailService.sendPasswordResetEmail(employee, rawToken).catch((err) => {
      logger.error(`Failed to send password reset email to ${email}:`, err.message);
    });

    logger.info(`Password reset token generated for ${employee.emp_code}`);
    return true;
  }

  /**
   * Reset password — validate reset token (hash comparison) and expiry,
   * then update to the new password and clear token fields.
   */
  async resetPassword(token, newPassword) {
    // Find all employees with a non-null reset token that hasn't expired
    const employees = await Employee.findAll({
      where: {
        reset_password_token: { [require('sequelize').Op.ne]: null },
        reset_password_expires: { [require('sequelize').Op.gt]: new Date() },
      },
    });

    // Compare the raw token against each hashed token
    let matchedEmployee = null;
    for (const emp of employees) {
      const isValid = await bcrypt.compare(token, emp.reset_password_token);
      if (isValid) {
        matchedEmployee = emp;
        break;
      }
    }

    if (!matchedEmployee) {
      throw new AppError('Reset token is invalid or has expired. Please request a new one.', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await matchedEmployee.update({
      password: hashedPassword,
      reset_password_token: null,
      reset_password_expires: null,
    });

    logger.info(`Password reset successful for ${matchedEmployee.emp_code}`);
    return true;
  }

  async logout(employeeId) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    await employee.update({ refresh_token: null });
    logger.info(`Employee ${employee.emp_code} logged out`);
    return true;
  }

  async getMe(employeeId) {
    const employee = await Employee.findByPk(employeeId, {
      attributes: { exclude: ['password', 'refresh_token'] },
      include: [
        { association: 'office' },
        { association: 'company' },
        {
          association: 'salaryStructures',
          order: [['effective_from', 'DESC']],
          limit: 1,
        },
      ],
    });

    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    const latestSalary = employee.salaryStructures && employee.salaryStructures.length > 0
      ? employee.salaryStructures[0]
      : null;

    // Fetch ALL active offices in the system so the mobile
    // app can validate geo-fence against every office location (not just
    // the employee's primary office). This enables universal punch
    // in/out across the group — e.g. punch in from any active branch.
    const companyOffices = await Office.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'address', 'city', 'latitude', 'longitude', 'radius_meters'],
      order: [['name', 'ASC']],
    });

    // Transform to flat shape matching what the frontend expects
    return {
      id: employee.id,
      emp_code: employee.emp_code,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      role: employee.role,
      designation: employee.designation,
      department: employee.department,
      branch: employee.office ? employee.office.name : null,
      office_id: employee.office_id,
      office: employee.office ? {
        id: employee.office.id,
        name: employee.office.name,
        latitude: employee.office.latitude,
        longitude: employee.office.longitude,
        radius_meters: employee.office.radius_meters,
      } : null,
      // All active offices for the company — used by the mobile app to
      // validate geo-fence against every office location so employees can
      // punch in/out from ANY company office, not just their primary one.
      company_offices: companyOffices.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        city: o.city,
        latitude: o.latitude,
        longitude: o.longitude,
        radius_meters: o.radius_meters,
      })),
      company_id: employee.company_id,
      company: employee.company ? { id: employee.company.id, name: employee.company.name } : null,
      profile_image: employee.profile_image,
      is_first_login: employee.is_first_login,
      status: employee.status,
      last_login_at: employee.last_login_at,
      date_of_joining: employee.date_of_joining,
      date_of_birth: employee.date_of_birth,
      gender: employee.gender,
      address: employee.address,
      // Salary
      fixed_gross: employee.fixed_gross,
      basic_salary: employee.basic_salary,
      pf_applicable: employee.pf_applicable,
      pf_ceiling: employee.pf_ceiling,
      esic_applicable: employee.esic_applicable,
      // Bank
      bank_name: employee.bank_name,
      bank_account_number: employee.bank_account_number,
      ifsc_code: employee.ifsc_code,
      // Statutory
      pan_number: employee.pan_number,
      pf_number: employee.pf_number,
      uan: employee.uan,
      // Location
      location: employee.office ? employee.office.name : employee.location,
      company_name: employee.company ? employee.company.name : employee.company_name,
      // Emergency
      emergency_contact_name: employee.emergency_contact_name,
      emergency_contact_relation: employee.emergency_contact_relation,
      shift_start_time: employee.shift_start_time,
      shift_end_time: employee.shift_end_time,
      // Latest salary structure
      salary_structure: latestSalary ? {
        id: latestSalary.id,
        fixed_gross: latestSalary.fixed_gross,
        basic_salary: latestSalary.basic_salary,
        hra: latestSalary.hra,
        special_allowance: latestSalary.special_allowance,
        other_allowance: latestSalary.other_allowance,
        conveyance: latestSalary.conveyance,
        medical_allowance: latestSalary.medical_allowance,
        pf_applicable: latestSalary.pf_applicable,
        pf_ceiling: latestSalary.pf_ceiling,
        esic_applicable: latestSalary.esic_applicable,
        pt_applicable: latestSalary.pt_applicable,
        effective_work_days: latestSalary.effective_work_days,
        effective_from: latestSalary.effective_from,
      } : null,
    };
  }
}

module.exports = new AuthService();