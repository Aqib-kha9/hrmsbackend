const express = require('express');
const router = express.Router();
const { authenticate, authenticateRefresh } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const { loginSchema, registerSchema, changePasswordSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema } = require('../validators/auth.validator');
const authController = require('../controllers/auth.controller');

// Public routes
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// Protected routes
router.post('/register', authenticate, requirePermission('employees:create'), validate(registerSchema), authController.register);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);

module.exports = router;