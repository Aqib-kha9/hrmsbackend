const employeeService = require('../services/employee.service');
const { Employee, Company, Office, Role, SalaryStructure, OnboardingInvitation } = require('../models');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');
const XLSX = require('xlsx');

class EmployeeController {
  async getMyProfile(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const result = await employeeService.getEmployeeById(employeeId);
      return success(res, 'Profile fetched', result, 200);
    } catch (err) {
      logger.error(`Get my profile error: ${err.message}`);
      return next(err);
    }
  }

  async updateMyProfile(req, res, next) {
    try {
      const employeeId = req.employee.id;
      const updateData = req.body;
      const result = await employeeService.updateEmployee(employeeId, updateData);
      return success(res, 'Profile updated', result, 200);
    } catch (err) {
      logger.error(`Update my profile error: ${err.message}`);
      return next(err);
    }
  }

  async getAllEmployees(req, res, next) {
    try {
      const { page, limit, department, role, status, search, company_id, office_id } = req.query;
      const result = await employeeService.getAllEmployees({ page, limit, department, role, status, search, company_id, office_id });
      return paginated(res, 'Employees fetched', result.data, result.pagination, 200);
    } catch (err) {
      logger.error(`Get all employees error: ${err.message}`);
      return next(err);
    }
  }

  async getEmployeeById(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.getEmployeeById(id);
      return success(res, 'Employee fetched', result, 200);
    } catch (err) {
      logger.error(`Get employee by id error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployee(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const result = await employeeService.updateEmployee(id, updateData);
      return success(res, 'Employee updated', result, 200);
    } catch (err) {
      logger.error(`Update employee error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const result = await employeeService.updateEmployeeStatus(id, status);
      return success(res, 'Employee status updated', result, 200);
    } catch (err) {
      logger.error(`Update employee status error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeRole(req, res, next) {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const result = await employeeService.updateEmployeeRole(id, role);
      return success(res, 'Employee role updated', result, 200);
    } catch (err) {
      logger.error(`Update employee role error: ${err.message}`);
      return next(err);
    }
  }

  async toggleLeaveAccess(req, res, next) {
    try {
      const { id } = req.params;
      const { is_leave_allowed } = req.body;
      const allowed = Boolean(is_leave_allowed);
      const employee = await employeeService.getEmployeeById(id);
      const currentModules = employee.app_modules || {};
      const updatedModules = { ...currentModules, leave: allowed };

      const result = await employeeService.updateEmployee(id, {
        is_leave_allowed: allowed,
        app_modules: updatedModules,
      });
      return success(
        res,
        `Leave module ${result.is_leave_allowed ? 'enabled' : 'disabled'} for ${result.name}`,
        result,
        200
      );
    } catch (err) {
      logger.error(`Toggle leave access error: ${err.message}`);
      return next(err);
    }
  }

  async updateAppModules(req, res, next) {
    try {
      const { id } = req.params;
      const {
        is_attendance_allowed,
        is_leave_allowed,
        is_payroll_allowed,
        is_loans_allowed,
        is_documents_allowed,
        is_letters_allowed,
        app_modules,
      } = req.body;

      const employee = await employeeService.getEmployeeById(id);
      const currentModules = employee.app_modules || {
        attendance: employee.is_attendance_allowed !== false,
        leave: employee.is_leave_allowed !== false,
        payroll: employee.is_payroll_allowed !== false,
        loans: employee.is_loans_allowed !== false,
        documents: employee.is_documents_allowed !== false,
        letters: employee.is_letters_allowed !== false,
      };

      const updatedModules = {
        ...currentModules,
        ...(app_modules || {}),
      };

      if (is_attendance_allowed !== undefined) updatedModules.attendance = Boolean(is_attendance_allowed);
      if (is_leave_allowed !== undefined) updatedModules.leave = Boolean(is_leave_allowed);
      if (is_payroll_allowed !== undefined) updatedModules.payroll = Boolean(is_payroll_allowed);
      if (is_loans_allowed !== undefined) updatedModules.loans = Boolean(is_loans_allowed);
      if (is_documents_allowed !== undefined) updatedModules.documents = Boolean(is_documents_allowed);
      if (is_letters_allowed !== undefined) updatedModules.letters = Boolean(is_letters_allowed);

      const updatePayload = {
        is_attendance_allowed: updatedModules.attendance !== false,
        is_leave_allowed: updatedModules.leave !== false,
        is_payroll_allowed: updatedModules.payroll !== false,
        is_loans_allowed: updatedModules.loans !== false,
        is_documents_allowed: updatedModules.documents !== false,
        is_letters_allowed: updatedModules.letters !== false,
        app_modules: updatedModules,
      };

      const result = await employeeService.updateEmployee(id, updatePayload);
      return success(
        res,
        `Mobile app module permissions successfully updated for ${result.name}`,
        result,
        200
      );
    } catch (err) {
      logger.error(`Update app modules error: ${err.message}`);
      return next(err);
    }
  }

  // ── Salary Structure ─────────────────────────────────────────────

  async getEmployeeSalary(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.getSalaryStructures(id);
      return success(res, 'Salary structure fetched', result, 200);
    } catch (err) {
      logger.error(`Get employee salary error: ${err.message}`);
      return next(err);
    }
  }

  async updateEmployeeSalary(req, res, next) {
    try {
      const { id } = req.params;
      const salaryData = req.body;
      const updatedBy = req.employee.id;
      const result = await employeeService.updateSalaryStructure(id, salaryData, updatedBy);
      return success(res, 'Salary structure updated', result, 201);
    } catch (err) {
      logger.error(`Update employee salary error: ${err.message}`);
      return next(err);
    }
  }

  async deleteEmployee(req, res, next) {
    try {
      const { id } = req.params;
      const result = await employeeService.deleteEmployee(id);
      return success(res, `Employee ${result.emp_code} deleted permanently`, result, 200);
    } catch (err) {
      logger.error(`Delete employee error: ${err.message}`);
      return next(err);
    }
  }

  // ── Admin Password Reset ──────────────────────────────────────────

  /**
   * Admin resets an employee's password directly.
   * Returns the new plain-text password so the admin can communicate it to
   * the employee through a side channel (in person / Slack / WhatsApp).
   */
  async adminResetPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { customPassword } = req.body;
      const adminId = req.employee.id;
      const result = await employeeService.adminResetPassword(id, adminId, customPassword);
      return success(res, 'Password reset successfully', result, 200);
    } catch (err) {
      logger.error(`Admin reset password error: ${err.message}`);
      return next(err);
    }
  }

  // ── Company-Specific Sequential Employee ID (Req 2.2) ──
  async getNextCode(req, res, next) {
    try {
      const target = req.query.company_id || req.query.companyId || req.query.prefix || null;
      const result = await employeeService.getNextEmployeeCodeDetails(target);
      return success(res, 'Next company-specific sequential employee code generated', result, 200);
    } catch (err) {
      logger.error(`Get next employee code error: ${err.message}`);
      return next(err);
    }
  }

  // ── Recently Added Employees (Req 1.1) ──
  async getRecentlyAdded(req, res, next) {
    try {
      const limit = req.query.limit || 6;
      const employees = await employeeService.getRecentlyAddedEmployees(limit);
      return success(res, 'Recently added employees retrieved successfully', employees, 200);
    } catch (err) {
      logger.error(`Get recently added employees error: ${err.message}`);
      return next(err);
    }
  }

  // ── Resigned Employee Re-Hiring (Req 23) ──
  async rehire(req, res, next) {
    try {
      const { id } = req.params;
      const rehireData = req.body;
      const approvedBy = req.employee.id;
      const result = await employeeService.rehireEmployee(id, rehireData, approvedBy);
      return success(res, `Employee ${result.emp_code} re-hired successfully`, result, 200);
    } catch (err) {
      logger.error(`Rehire employee error: ${err.message}`);
      return next(err);
    }
  }

  // ── Export Full Onboarding & Employee Master Excel ──
  async exportOnboardingMasterExcel(req, res, next) {
    try {
      const employees = await Employee.findAll({
        order: [['id', 'ASC']],
        include: [
          { model: Company, as: 'company', attributes: ['id', 'name', 'code', 'email', 'phone', 'city', 'state'] },
          { model: Office, as: 'office', attributes: ['id', 'name', 'offices_code', 'city', 'state', 'address'] },
          { model: Role, as: 'roleDetails', attributes: ['id', 'name'] },
          { model: SalaryStructure, as: 'salaryStructures', where: { is_active: true }, required: false },
        ],
      });

      const invitations = await OnboardingInvitation.findAll({
        order: [['id', 'DESC']],
        include: [
          { model: Company, as: 'company', attributes: ['name'] },
          { model: Office, as: 'office', attributes: ['name', 'city'] },
        ],
      });

      // Sheet 1: Employee Onboarding Master
      const empRows = employees.map((emp, index) => {
        const struct = (emp.salaryStructures && emp.salaryStructures[0]) || {};
        const docs = typeof emp.documents === 'object' && emp.documents ? emp.documents : {};
        const docsList = Object.keys(docs).filter(k => !!docs[k]).join(', ') || (emp.photo_url ? 'Photo' : 'None');

        return {
          'Sr No': index + 1,
          'Employee ID': emp.emp_code || '',
          'Full Name': emp.name || '',
          'Employment Status': (emp.status || 'active').toUpperCase(),
          'Company': emp.company?.name || '',
          'Work Location / Office': emp.office?.name || emp.location || '',
          'City': emp.office?.city || '',
          'State': emp.office?.state || '',
          'Department': emp.department || '',
          'Designation': emp.designation || '',
          'Role / Access Group': emp.roleDetails?.name || emp.role_name || 'Staff',
          'Date of Joining': emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN') : '',
          'Work Email': emp.email || '',
          'Mobile Number': emp.phone || '',
          'Alternate Phone': emp.alternate_phone || '',
          'Date of Birth': emp.dob ? new Date(emp.dob).toLocaleDateString('en-IN') : '',
          'Gender': emp.gender ? (emp.gender.charAt(0).toUpperCase() + emp.gender.slice(1)) : '',
          'Marital Status': emp.marital_status ? (emp.marital_status.charAt(0).toUpperCase() + emp.marital_status.slice(1)) : '',
          'Blood Group': emp.blood_group || '',
          'Father Name': emp.father_name || '',
          'Mother Name': emp.mother_name || '',
          'Present Address': emp.present_address || emp.address || '',
          'Permanent Address': emp.permanent_address || emp.address || '',
          'Aadhaar Number': emp.aadhaar_number || '',
          'PAN Card Number': emp.pan_number || '',
          'UAN Number': emp.uan || '',
          'PF Number': emp.pf_number || '',
          'ESIC IP Number': emp.esi_number || '',
          'PF Applicable': emp.pf_applicable !== false ? 'Yes' : 'No',
          'ESIC Applicable': emp.esic_applicable !== false ? 'Yes' : 'No',
          'PT Applicable': emp.pt_applicable !== false ? 'Yes' : 'No',
          'Bank Name': emp.bank_name || '',
          'Account Number': emp.bank_account_number ? String(emp.bank_account_number) : '',
          'IFSC Code': emp.ifsc_code || '',
          'Bank Branch': emp.bank_branch || '',
          'Emergency Contact Person': emp.emergency_contact_name || '',
          'Emergency Contact Relation': emp.emergency_contact_relation || '',
          'Emergency Contact Phone': emp.emergency_contact_phone || '',
          'Nominee Name': emp.nominee_name || '',
          'Nominee Relation': emp.nominee_relation || '',
          'Nominee DOB': emp.nominee_dob ? new Date(emp.nominee_dob).toLocaleDateString('en-IN') : '',
          'Monthly Fixed Gross (₹)': Number(emp.fixed_gross) || Number(struct.gross_amount) || 0,
          'Annual CTC (₹)': Number(struct.ctc_amount) || Number(emp.ctc_annual) || (Number(emp.fixed_gross) * 12) || 0,
          'Basic Salary Monthly (₹)': Number(struct.basic_salary) || Math.round((Number(emp.fixed_gross) || 0) * 0.50),
          'HRA Monthly (₹)': Number(struct.hra) || Math.round((Number(struct.basic_salary) || ((Number(emp.fixed_gross) || 0) * 0.50)) * 0.40),
          'Special Allowance Monthly (₹)': Number(struct.special_allowance) || 0,
          'Employer PF (13%) Monthly (₹)': Number(struct.employer_pf) || 0,
          'Employer ESIC (3.25%) Monthly (₹)': Number(struct.employer_esic) || 0,
          'Gratuity Monthly (₹)': Number(struct.gratuity_amount) || 0,
          'Statutory Bonus Monthly (₹)': Number(struct.statutory_bonus) || 0,
          'Ex-gratia Monthly (₹)': Number(struct.exgratia_bonus) || 0,
          'Employee PF (12%) Monthly (₹)': Number(struct.employee_pf) || 0,
          'Employee ESIC (0.75%) Monthly (₹)': Number(struct.employee_esic) || 0,
          'Professional Tax (₹)': Number(struct.pt_amount) || 0,
          'Net Take Home Monthly (₹)': Number(struct.net_take_home) || 0,
          'Shift Timing': `${emp.shift_start_time || '09:30'} - ${emp.shift_end_time || '18:30'}`,
          'Shift Type': emp.shift_type || 'fixed',
          'Geofence Tracking': emp.geofence_enabled ? 'Enabled' : 'Disabled',
          'Documents On File': docsList,
          'Account Created At': emp.createdAt ? new Date(emp.createdAt).toISOString().split('T')[0] : '',
        };
      });

      // Sheet 2: Candidate Onboarding Submissions
      const invRows = invitations.map((inv, idx) => {
        const sub = typeof inv.submitted_data === 'object' && inv.submitted_data ? inv.submitted_data : {};
        return {
          'Sr No': idx + 1,
          'Candidate Name': inv.candidate_name || sub.name || '',
          'Email Address': inv.email || '',
          'Mobile Phone': inv.phone || sub.phone || '',
          'Company': inv.company?.name || '',
          'Office / Location': inv.office?.name || sub.location || '',
          'Designation': inv.designation || sub.designation || '',
          'Department': inv.department || sub.department || '',
          'Offered Monthly Gross (₹)': Number(inv.fixed_gross) || Number(sub.fixed_gross) || 0,
          'Onboarding Status': (inv.status || 'pending').toUpperCase(),
          'Invitation Sent Date': inv.createdAt ? new Date(inv.createdAt).toISOString().split('T')[0] : '',
          'Invitation Expires Date': inv.expires_at ? new Date(inv.expires_at).toISOString().split('T')[0] : '',
          'Approval Date': inv.approved_at ? new Date(inv.approved_at).toISOString().split('T')[0] : 'Pending',
          'Aadhaar Submitted': sub.aadhaar_number || 'Pending',
          'PAN Submitted': sub.pan_number || 'Pending',
          'Bank Name Submitted': sub.bank_name || 'Pending',
          'Account No Submitted': sub.bank_account_number ? String(sub.bank_account_number) : 'Pending',
          'IFSC Submitted': sub.ifsc_code || 'Pending',
          'Address Submitted': sub.address || sub.present_address || 'Pending',
          'Appointment Letter Status': sub.appointment_status || 'Not Issued',
          'Appointment Signed At': sub.appointment_signed_at ? new Date(sub.appointment_signed_at).toLocaleString('en-IN') : 'Pending',
          'Rejection Reason': inv.rejection_reason || 'N/A',
        };
      });

      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.json_to_sheet(empRows);
      const colWidths1 = Object.keys(empRows[0] || {}).map(key => ({
        wch: Math.max(key.length, 14)
      }));
      ws1['!cols'] = colWidths1;
      XLSX.utils.book_append_sheet(wb, ws1, 'Employee Onboarding Master');

      if (invRows.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(invRows);
        const colWidths2 = Object.keys(invRows[0] || {}).map(key => ({
          wch: Math.max(key.length, 14)
        }));
        ws2['!cols'] = colWidths2;
        XLSX.utils.book_append_sheet(wb, ws2, 'Candidate Submissions');
      }

      const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `Employee_Onboarding_Master_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(excelBuffer);
    } catch (err) {
      logger.error(`Export onboarding master excel error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new EmployeeController();