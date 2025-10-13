// Updated: 2024-13-10
// by: DatNB


const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validate,
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
    updateProfileSchema
} = require('../middlewares/validation.middleware');

// Public routes

router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// Protected routes (require authentication)
router.use(authenticate);

router.post('/register', requireRole(['owner', 'manager']) , validate(registerSchema), authController.register);
router.post('/logout', authController.logout);
router.post('/change-password', validate(changePasswordSchema), authController.changePassword);
router.get('/profile', authController.getProfile);
router.put('/profile', validate(updateProfileSchema), authController.updateProfile);


module.exports = router;