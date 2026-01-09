// Updated: 2026-01-04
// by: DatNB & MinhBH


const { z, ZodError } = require('zod');
const multer = require('multer');
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
    avatar_url: z.string().url().optional(),

    phone: z
        .string()
        .regex(/^(0|\+84)[0-9]{9}$/, 'Số điện thoại không hợp lệ')
        .optional()
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
      buildingId: z.preprocess(
    (val) => {
      if (val === '' || val === undefined || val === null) return undefined;
      return Number(val);
    },
    z.number().int().positive().optional()
  ),
    idNumber: z.string()
        .min(9, 'ID number must be at least 9 characters')
        .max(12, 'ID number must not exceed 12 characters')
        .regex(/^[0-9]+$/, { message: 'ID number must contain only numbers' }),
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

const serviceChargeSchema = z.object({
    service_type: z.string().min(1, "Service type is required"), // e.g., "Electricity"
    quantity: z.number().nonnegative().optional().default(1),
    unit_price: z.number().nonnegative().optional(),
    amount: z.number().nonnegative({ message: "Amount cannot be negative" }),
    description: z.string().optional()
});

const baseBillSchema = z.object({
    contract_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'contract_id must be a positive integer' })).optional(),

    tenant_user_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive({ message: 'tenant_user_id must be a positive integer' })).optional(),
    
    // Validate Bill Type
    bill_type: z.enum([
        'monthly_rent', 'utilities', 'maintenance', 
        'penalty', 'deposit', 'other'
    ]).optional(),

    total_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().gt(2000, { message: 'Total amount must be greater than 2,000 VND' })).optional(),
    
    description: z.string().min(1, 'Description is required').max(255).optional(),
    
    billing_period_start: z.string().datetime({ message: "Invalid date format" }).optional(),
    billing_period_end: z.string().datetime({ message: "Invalid date format" }).optional(),
    due_date: z.string().datetime({ message: "Invalid date format" }).optional(),
    penalty_amount: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().nonnegative({ message: 'penalty_amount cannot be negative' })).optional(),
    
    status: z.enum(['draft', 'issued']).optional(),

    // [NEW] Allow array of service charges
    service_charges: z.array(serviceChargeSchema).optional()
});

// [UPDATED] Draft Schema
const createDraftBillSchema = baseBillSchema.partial();

// [UPDATED] Issued Schema
const createIssuedBillSchema = baseBillSchema.required({
    contract_id: true, // Now required to link to contract
    tenant_user_id: true,
    total_amount: true,
    bill_type: true,   // Now required
    billing_period_start: true,
    billing_period_end: true,
    due_date: true,
}).refine(data => new Date(data.billing_period_start) < new Date(data.billing_period_end), {
    message: "Billing end date must be after start date",
    path: ["billing_period_end"],
}).refine(data => new Date(data.billing_period_end) <= new Date(data.due_date), {
    message: "Due date must be after or equal to billing end date",
    path: ["due_date"],
});

// Update Draft Logic
const updateDraftBillSchema = baseBillSchema.partial().superRefine((data, ctx) => {
    if (data.status === 'issued') {
        // Validation logic for Publishing
        if (!data.contract_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "contract_id is required to publish", path: ["contract_id"] });
        if (!data.tenant_user_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tenant_user_id is required to publish", path: ["tenant_user_id"] });
        if (!data.total_amount) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "total_amount is required to publish", path: ["total_amount"] });
        if (!data.bill_type) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bill_type is required to publish", path: ["bill_type"] });
        if (!data.billing_period_start) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billing_period_start is required to publish", path: ["billing_period_start"] });
        if (!data.billing_period_end) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billing_period_end is required to publish", path: ["billing_period_end"] });
        if (!data.due_date) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "due_date is required to publish", path: ["due_date"] });
    }
});

const updateIssuedBillSchema = baseBillSchema.partial().omit({
    // 🚫 FORBIDDEN FIELDS (Immutable once issued)
    tenant_user_id: true,
    contract_id: true,     // Cannot re-assign to another contract
    bill_type: true,       // Cannot change Rent to Utility
    billing_period_start: true,
    billing_period_end: true,

    // 💰 FINANCIAL INTEGRITY
    total_amount: true,    // Cannot change the total
    service_charges: true, // Cannot change line items
}).extend({
    // ✅ ALLOWED FIELDS
    status: z.enum([
        'issued',
        'overdue',
        'paid',
        'partially_paid',
        'cancelled'
    ]).optional(),

    // Allow updating due_date (for extensions) and notes
    due_date: z.string().datetime().optional(),
    description: z.string().max(255).optional(),
    note: z.string().optional()
});

// Schema for Manager/Owner sending a notification
const sendNotificationSchema = z.object({
    recipient_id: z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') return Number(val);
        return val;
    }, z.number().int().positive()),
    title: z.string().min(1, "Title is required").max(300),
    body: z.string().min(1, "Body is required"),
    payload: z.record(z.any()).optional() // e.g., { "link": "/some/path" }
});

const sendBroadcastSchema = z.object({
    title: z.string().min(1, "Title is required").max(300),
    body: z.string().min(1, "Body is required"),
    payload: z.record(z.any()).optional()
});

// Schema for registering a device
const registerDeviceSchema = z.object({
    token: z.string().min(1, "Token is required"),
    device_type: z.enum(['IOS', 'ANDROID', 'WEB'])
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

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
        }
    }
});
// Middleware để log multer errors
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('Multer Error:', err);
        return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
        });
    } else if (err) {
        console.error('Upload Error:', err);
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    next();
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
    updateIssuedBillSchema,
    sendNotificationSchema,
    sendBroadcastSchema,
    registerDeviceSchema,
    upload,
    handleMulterError
};