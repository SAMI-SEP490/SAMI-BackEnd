// src/middlewares/validation.middleware.js

const { z } = require('zod');

const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    phone: z.string().min(10, 'Phone number must be at least 10 characters'),
    full_name: z.string().min(1, 'Full name is required').optional(),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    birthday: z.string().or(z.date()).optional()
});

const loginSchema = z.object({
    email: z.string().min(1, 'Email or phone is required'),
    password: z.string().min(1, 'Password is required')
});

const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required')
});

const forgotPasswordSchema = z.object({
    email: z.string().min(1, 'Email or phone is required')
});

const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters')
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

const updateProfileSchema = z.object({
    full_name: z.string().min(1).optional(),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    birthday: z.string().or(z.date()).optional(),
    avatar_url: z.string().url().optional()
});

const validate = (schema) => {
    return (req, res, next) => {
        try {
            schema.parse(req.body);
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation error',
                    errors: err.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(err);
        }
    };
};

module.exports = {
    validate,
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
    updateProfileSchema
};