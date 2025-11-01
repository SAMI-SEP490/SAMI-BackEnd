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

const baseBillSchema = z.object({
    tenant_user_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'tenant_user_id must be a positive integer' })).optional(),
    
    room_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'room_id must be a positive integer' })).optional(),
    
    total_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().positive({ message: 'total_amount must be positive' })).optional(),
    
    description: z.string().min(1, 'Description is required').max(255).optional(),
    
    billing_period_start: z.string().datetime({ message: "Invalid date format" }).optional(),
    billing_period_end: z.string().datetime({ message: "Invalid date format" }).optional(),
    due_date: z.string().datetime({ message: "Invalid date format" }).optional(),
    penalty_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().nonnegative({ message: 'penalty_amount cannot be negative' })).optional(),
    
    status: z.enum(['draft', 'issued']).optional()
});

// We can just use the partial base schema, as a draft can be very empty.
const createDraftBillSchema = baseBillSchema.partial();

const createIssuedBillSchema = baseBillSchema.required({
    tenant_user_id: true,
    room_id: true,
    total_amount: true,
    description: true,
    billing_period_start: true,
    billing_period_end: true,
    due_date: true,
}).refine(data => new Date(data.billing_period_start) < new Date(data.billing_period_end), {
    message: "Billing end date must be after start date",
    path: ["billing_period_end"],
}).refine(data => new Date(data.billing_period_end) < new Date(data.due_date), {
    message: "Due date must be after billing end date",
    path: ["due_date"],
});

const updateDraftBillSchema = baseBillSchema.partial().superRefine((data, ctx) => {
    if (data.status === 'issued') {
        // If they try to "publish" the draft, it must have all required fields.
        // We're checking the data *being sent*. The service layer must check the *final merged* data.
        if (data.tenant_user_id === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tenant_user_id is required to publish", path: ["tenant_user_id"] });
        if (data.room_id === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "room_id is required to publish", path: ["room_id"] });
        if (data.total_amount === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "total_amount is required to publish", path: ["total_amount"] });
        if (data.description === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "description is required to publish", path: ["description"] });
        if (data.billing_period_start === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billing_period_start is required to publish", path: ["billing_period_start"] });
        if (data.billing_period_end === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billing_period_end is required to publish", path: ["billing_period_end"] });
        if (data.due_date === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "due_date is required to publish", path: ["due_date"] });
    }
});

const updateIssuedBillSchema = baseBillSchema.partial().omit({
    tenant_user_id: true, // Once issued, you can't change who/what it's for
    room_id: true,
    billing_period_start: true,
    billing_period_end: true,
    status: true, // Cannot change status of an issued bill (except to 'cancelled' via DELETE)
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
    createDraftBillSchema,
    createIssuedBillSchema,
    updateDraftBillSchema,
    updateIssuedBillSchema
};