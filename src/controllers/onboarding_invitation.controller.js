const onboardingInvitationService = require('../services/onboarding_invitation.service');
const { success, paginated } = require('../utils/response');
const logger = require('../utils/logger');

class OnboardingInvitationController {
  // ── Admin: Create and send invitation link ──
  async createInvitation(req, res, next) {
    try {
      const issuedBy = req.employee ? req.employee.id : null;
      const result = await onboardingInvitationService.createInvitation(req.body, issuedBy);
      return success(res, 'Onboarding invitation created successfully', result, 201);
    } catch (err) {
      logger.error(`Create onboarding invitation error: ${err.message}`);
      return next(err);
    }
  }

  // ── Admin: List all invitations ──
  async getAllInvitations(req, res, next) {
    try {
      const { status, search, page, limit } = req.query;
      const result = await onboardingInvitationService.getAllInvitations({ status, search, page, limit });
      return paginated(res, 'Invitations retrieved successfully', result.data, result.pagination);
    } catch (err) {
      logger.error(`Get all invitations error: ${err.message}`);
      return next(err);
    }
  }

  // ── Public: Validate invitation token ──
  async validateToken(req, res, next) {
    try {
      const { token } = req.params;
      const result = await onboardingInvitationService.validateToken(token);
      return success(res, 'Invitation token valid', result, 200);
    } catch (err) {
      logger.error(`Validate token error: ${err.message}`);
      return next(err);
    }
  }

  // ── Public: Candidate self-submits details ──
  async submitSelfOnboarding(req, res, next) {
    try {
      const { token } = req.params;
      const result = await onboardingInvitationService.submitSelfOnboarding(token, req.body);
      return success(res, result.message, result, 200);
    } catch (err) {
      logger.error(`Submit self-onboarding error: ${err.message}`);
      return next(err);
    }
  }

  // ── Admin: Approve candidate submission and activate account ──
  async approveInvitation(req, res, next) {
    try {
      const { id } = req.params;
      const approvedBy = req.employee.id;
      const result = await onboardingInvitationService.approveInvitation(id, approvedBy, req.body);
      return success(res, 'Candidate successfully approved and employee profile activated', result, 200);
    } catch (err) {
      logger.error(`Approve invitation error: ${err.message}`);
      return next(err);
    }
  }

  // ── Admin: Reject submission / cancel invitation ──
  async rejectInvitation(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const rejectedBy = req.employee.id;
      const result = await onboardingInvitationService.rejectInvitation(id, reason, rejectedBy);
      return success(res, 'Invitation rejected', result, 200);
    } catch (err) {
      logger.error(`Reject invitation error: ${err.message}`);
      return next(err);
    }
  }
}

module.exports = new OnboardingInvitationController();
