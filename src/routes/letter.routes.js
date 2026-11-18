const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const letterController = require('../controllers/letter.controller');
const offerLetterController = require('../controllers/offer_letter.controller');
const letterTemplateController = require('../controllers/letter_template.controller');

// ── Public Letter Digital Acceptance routes (Candidate / Employee facing, no auth required) ──
router.get('/public/offer/:token', letterController.getPublicOfferLetter);
router.post('/public/offer/:token/respond', letterController.respondPublicOfferLetter);
router.get('/public/offer/:token/pdf', letterController.downloadPublicOfferLetterPDF);

router.get('/public/appointment/:token', letterController.getPublicAppointmentLetter);
router.post('/public/appointment/:token/respond', letterController.respondPublicAppointmentLetter);
router.get('/public/appointment/:token/pdf', letterController.downloadPublicAppointmentLetterPDF);

router.get('/public/letter/:token', letterController.getPublicLetter);
router.post('/public/letter/:token/respond', letterController.respondPublicLetter);
router.get('/public/letter/:token/pdf', letterController.downloadPublicLetterPDF);

// All routes below require authentication
router.use(authenticate);

// ── Employee routes ──
router.get('/my', letterController.getMyLetters);
router.get('/my/:id', letterController.getLetterById);
router.patch('/my/:id/acknowledge', letterController.acknowledgeLetter);

// ── Admin/HR letter routes ──
router.get('/', requirePermission('letters:read'), letterController.getAllLetters);
router.post('/issue', requirePermission('letters:create'), letterController.issueLetter);
router.post('/appointment/issue-and-send', requirePermission('letters:create'), letterController.issueAndSendAppointmentLetter);
router.patch('/:id', requirePermission('letters:update'), letterController.updateLetter);
router.delete('/:id', requirePermission('letters:delete'), letterController.deleteLetter);

// ── Generate PDF & send email (Admin/HR) ──
router.get('/generate-pdf', requirePermission('letters:read'), letterController.generateLetterPDF);
router.post('/generate-pdf', requirePermission('letters:create'), letterController.generateLetterPDF);
router.get('/:id/pdf', requirePermission('letters:read'), letterController.downloadLetterByIdPDF);
router.post('/send-email', requirePermission('letters:create'), letterController.sendLetterEmail);
router.post('/:id/send-email', requirePermission('letters:create'), letterController.sendExistingLetterEmail);
router.post('/:id/send-onboarding-invite', requirePermission('letters:create'), letterController.sendOnboardingInvite);

// ── Offer letter specific routes (Admin/HR only) ──
router.get('/offer-letter/:employeeId/preview', requirePermission('letters:read'), offerLetterController.previewOfferLetter);
router.post('/offer-letter/:employeeId/send', requirePermission('letters:create'), offerLetterController.sendOfferLetter);

// ── Letter Template routes (Admin/HR) ──
router.get('/templates', requirePermission('letters:read'), letterTemplateController.getTemplates);
router.get('/templates/all', requirePermission('letters:read'), letterTemplateController.getAllTemplates);
router.get('/templates/preview', requirePermission('letters:read'), letterTemplateController.previewTemplate);
router.post('/templates/preview', requirePermission('letters:read'), letterTemplateController.previewTemplate);
router.get('/templates/:id', requirePermission('letters:read'), letterTemplateController.getTemplateById);
router.post('/templates', requirePermission('letters:create'), letterTemplateController.createTemplate);
router.post('/templates/seed', requirePermission('letters:create'), letterTemplateController.seedDefaultTemplates);
router.patch('/templates/:id', requirePermission('letters:update'), letterTemplateController.updateTemplate);
router.delete('/templates/:id', requirePermission('letters:delete'), letterTemplateController.deleteTemplate);

module.exports = router;