// Updated: 2025-15-10
// by: DatNB


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

const createContractSchema = z
    .object({
        room_id: z.number({
            invalid_type_error: 'room_id phải là một số',
            required_error: 'room_id là bắt buộc'
        }).int(),
        tenant_user_id: z.number({
            invalid_type_error: 'tenant_user_id phải là một số',
            required_error: 'tenant_user_id là bắt buộc'
        }).int(),
        start_date: isoDateString().refine(val => {
            // đảm bảo string parse được thành Date
            return !Number.isNaN(Date.parse(val));
        }, { message: 'start_date phải là một ngày hợp lệ (ISO format)' }),
        end_date: isoDateString().refine(val => {
            return !Number.isNaN(Date.parse(val));
        }, { message: 'end_date phải là một ngày hợp lệ (ISO format)' }),
        rent_amount: z.number({
            invalid_type_error: 'rent_amount phải là một số'
        }).positive({ message: 'rent_amount phải lớn hơn 0' }).optional(),
        deposit_amount: z.number({
            invalid_type_error: 'deposit_amount phải là một số'
        }).positive({ message: 'deposit_amount phải lớn hơn 0' }).optional(),
        status: z.enum(['pending', 'active', 'terminated', 'expired']).optional().or(z.string().optional()).refine(v => {
            // nếu undefined -> ok; nếu là string thì phải thuộc các giá trị trên
            if (v === undefined) return true;
            return ['pending', 'active', 'terminated', 'expired'].includes(v);
        }, { message: 'status phải là pending, active, terminated hoặc expired' }),
        note: z.string().max(500, { message: 'note không được vượt quá 500 ký tự' }).optional()
    })
    .refine((data) => {
        // start_date < end_date
        const start = new Date(data.start_date);
        const end = new Date(data.end_date);
        return start < end;
    }, {
        message: 'start_date phải nhỏ hơn end_date',
        path: ['start_date'] // đặt lỗi vào field start_date
    });

const updateContractSchema = z
    .object({
        start_date: z.string().optional().refine(v => {
            if (v === undefined) return true;
            return !Number.isNaN(Date.parse(v));
        }, { message: 'start_date phải là một ngày hợp lệ (ISO format)' }),
        end_date: z.string().optional().refine(v => {
            if (v === undefined) return true;
            return !Number.isNaN(Date.parse(v));
        }, { message: 'end_date phải là một ngày hợp lệ (ISO format)' }),
        rent_amount: z.number({
            invalid_type_error: 'rent_amount phải là một số'
        }).positive({ message: 'rent_amount phải lớn hơn 0' }).optional(),
        deposit_amount: z.number({
            invalid_type_error: 'deposit_amount phải là một số'
        }).positive({ message: 'deposit_amount phải lớn hơn 0' }).optional(),
        status: z.string().optional().refine(v => {
            if (v === undefined) return true;
            return ['pending', 'active', 'terminated', 'expired'].includes(v);
        }, { message: 'status phải là pending, active, terminated hoặc expired' }),
        note: z.string().max(500, { message: 'note không được vượt quá 500 ký tự' }).optional()
    })
    .superRefine((data, ctx) => {
        if (data.start_date && data.end_date) {
            const start = new Date(data.start_date);
            const end = new Date(data.end_date);
            if (!(start < end)) {
                // chèn lỗi vào start_date (cũng có thể push vào end_date tuỳ muốn)
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'start_date phải nhỏ hơn end_date',
                    path: ['start_date']
                });
            }
        }
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
    createContractSchema,
    updateContractSchema
};