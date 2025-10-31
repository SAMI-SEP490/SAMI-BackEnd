// Updated: 2025-18-10
// by: DatNB & MinhBH


const { z, ZodError } = require('zod');

const isoDateString = () =>
    z
        .string({
            invalid_type_error: 'phải là một ngày hợp lệ (ISO format)',
            required_error: 'là bắt buộc'
        })
        .refine((v) => {
            // Accept strings that Date.parse can parse (ISO-like). Date.parse allows many formats;
            // nếu cần nghiêm ngặt hơn có thể dùng regex.
            return !Number.isNaN(Date.parse(v));
        }, { message: 'phải là một ngày hợp lệ (ISO format)' });

const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    phone: z.string().min(10, 'Phone number must be at least 10 characters'),
    full_name: z.string().min(1, 'Full name is required'),
    gender: z.enum(['Male', 'Female', 'Other']),
    birthday: z.string().or(z.date())
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
    userId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'userId must be a positive integer' })),
    resetToken: z.string().min(1, 'Token is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters')
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

// New OTP schemas (Zod)
const verifyOTPSchema = z.object({
    userId: z.preprocess((val) => {
        // chuyển chuỗi sang số nếu cần
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'userId must be a positive integer' })),
    otp: z
        .string()
        .length(6, { message: 'OTP must be 6 digits' })
        .regex(/^[0-9]+$/, { message: 'OTP must contain only numbers' }),
});

const resendOTPSchema = z.object({
    userId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'userId must be a positive integer' })),
});
const changeToTenantSchema = z.object({
    userId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'userId must be a positive integer' })),
    roomId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'roomId must be a positive integer' })),
    idNumber: z.string()
        .min(9, 'ID number must be at least 9 characters')
        .max(12, 'ID number must not exceed 12 characters')
        .regex(/^[0-9]+$/, { message: 'ID number must contain only numbers' }),
    emergencyContactPhone: z.string()
        .min(10, 'Phone number must be at least 10 digits')
        .max(11, 'Phone number must not exceed 11 digits')
        .regex(/^[0-9]+$/, { message: 'Phone number must contain only numbers' }),
    note: z.string().optional()
});

const changeToManagerSchema = z.object({
    userId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'userId must be a positive integer' })),
    buildingId: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'buildingId must be a positive integer' })),
    assignedFrom: z.string().or(z.date()).optional(),
    assignedTo: z.string().or(z.date()).optional(),
    note: z.string().optional()
}).refine((data) => {
    // Validate assignedTo is after assignedFrom if both exist
    if (data.assignedFrom && data.assignedTo) {
        const fromDate = new Date(data.assignedFrom);
        const toDate = new Date(data.assignedTo);
        return toDate > fromDate;
    }
    return true;
}, {
    message: 'assignedTo must be after assignedFrom',
    path: ['assignedTo']
});

const updateUserSchema = z.object({
    // User fields
    full_name: z.string().min(1, 'Full name is required'),
    gender: z.enum(['Male', 'Female', 'Other']),
    birthday: z.string().or(z.date()),
    status: z.string().min(1, 'Status cannot be empty'),

    // Role-specific fields (all optional)
    
    // For Tenants, Managers, Owners
    note: z.string().optional(),
    
    // For Owners (uses 'notes' plural)
    notes: z.string().optional(),

    // For Tenants
    tenant_since: z.string().or(z.date()).optional(),
    emergency_contact_phone: z.string()
        .min(10, 'Phone number must be at least 10 digits')
        .max(11, 'Phone number must not exceed 11 digits')
        .regex(/^[0-9]+$/, { message: 'Phone number must contain only numbers' })
        ,
    id_number: z.string()
        .min(9, 'ID number must be at least 9 characters')
        .max(12, 'ID number must not exceed 12 characters')
        .regex(/^[0-9]+$/, { message: 'ID number must contain only numbers' })
        ,
    
    // For Managers
    building_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'buildingId must be a positive integer' })).optional(),
    assigned_from: z.string().or(z.date()).optional(),
    assigned_to: z.string().or(z.date()).optional(),
})
.refine((data) => {
    // Validate assignedTo is after assignedFrom if both exist
    if (data.assigned_from && data.assigned_to) {
        const fromDate = new Date(data.assigned_from);
        const toDate = new Date(data.assigned_to);
        return toDate > fromDate;
    }
    return true;
}, {
    message: 'assigned_to must be after assigned_from',
    path: ['assigned_to']
});

const createPaymentSchema = z.object({
    billIds: z.array(
        z.preprocess((val) => {
            // Convert string to number if needed
            if (typeof val === 'string' && val.trim() !== '') return Number(val);
            return val;
        }, z.number().int().positive({ message: 'bill_id must be a positive integer' }))
    ).min(1, { message: 'billIds must be a non-empty array' })
});

const billing_cycle = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  EVERY_2_MONTHS: 'EVERY_2_MONTHS',
  HALF_A_YEAR: 'HALF_A_YEAR',
  YEARLY: 'YEARLY',
};

const baseBillSchema = z.object({
    tenant_user_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'tenant_user_id must be a positive integer' })),
    total_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().positive({ message: 'total_amount must be positive' })),
    description: z.string().min(1, 'Description is required').max(255),
    is_recurring: z.boolean().optional(),
    billing_cycle: z.nativeEnum(billing_cycle).optional(),
    penalty_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().nonnegative({ message: 'penalty_amount cannot be negative' })).optional(),
    status: z.enum(['draft', 'master']).optional()
    // **NO .refine() here yet**
});

const billSchema = baseBillSchema.refine(data => {
    // If recurring, cycle must be present
    if (data.is_recurring === true && !data.billing_cycle) {
        return false;
    }
    // Add other CREATE-specific refinements if needed
    return true;
}, {
    message: "If recurring, cycle is required.",
    path: ["billing_cycle"]
});

const updateBillSchema = baseBillSchema.partial().refine(data => {
    // If recurring, cycle must be present
    if (data.is_recurring === true && !data.billing_cycle) {
        return false;
    }
    // Add other CREATE-specific refinements if needed
    return true;
}, {
    message: "If recurring, cycle is required.",
    path: ["billing_cycle"]
});

const validate = (schema) => {
    return (req, res, next) => {
        try {
            // parse và gán lại req.body đã "clean"
            req.body = schema.parse(req.body);
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation error',
                    errors: err.errors.map((e) => ({
                        field: e.path.join('.'),
                        message: e.message,
                    })),
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
    updateProfileSchema,
    verifyOTPSchema,
    resendOTPSchema,
    changeToTenantSchema,
    changeToManagerSchema,
    updateUserSchema,
    createPaymentSchema,
    billSchema,
    updateBillSchema
};