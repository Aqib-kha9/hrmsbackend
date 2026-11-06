const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, requirePermission } = require('../middleware/role.middleware');
const onboardingInvitationController = require('../controllers/onboarding_invitation.controller');

// ── Public Routes (for prospective candidates completing self-onboarding) ──
router.get('/public/validate/:token', onboardingInvitationController.validateToken);
router.post('/public/submit/:token', onboardingInvitationController.submitSelfOnboarding);

// ── Protected Admin/HR Routes ──
router.use(authenticate);
router.post('/invite', requirePermission('onboarding:create'), onboardingInvitationController.createInvitation);
router.get('/invitations', requirePermission('onboarding:read'), onboardingInvitationController.getAllInvitations);
router.post('/approve/:id', requirePermission('onboarding:update'), onboardingInvitationController.approveInvitation);
router.post('/reject/:id', requirePermission('onboarding:update'), onboardingInvitationController.rejectInvitation);

module.exports = router;
