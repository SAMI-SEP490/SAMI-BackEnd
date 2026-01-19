// Updated: 2025-10-24
// by: DatNB


const Joi = require('joi');

// Schema for guest detail object
const guestDetailSchema = Joi.object({
    full_name: Joi.string()
        .max(200)
        .required()
        .messages({
            'string.empty': 'Họ và tên khách không được để trống',
            'string.max': 'Họ và tên khách không được vượt quá 200 ký tự',
            'any.required': 'Họ và tên khách là bắt buộc'
        }),

    id_type: Joi.string()
        .valid('national_id', 'passport', 'other')
        .default('national_id')
        .messages({
            'any.only': 'Loại ID phải là một trong các loại sau: national_id, passport, other'
        }),

    id_number: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'CCCD/Hộ chiếu không được vượt quá 100 ký tự'
        }),

    date_of_birth: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .max('now')
        .messages({
            'date.format': 'Ngày sinh phải theo định dạng ISO (YYYY-MM-DD)',
            'date.max': 'Ngày sinh không thể là ngày trong tương lai'
        }),

    nationality: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Quốc tịch không được vượt quá 100 ký tự'
        }),

    gender: Joi.string()
        .max(10)
        .valid('Male', 'Female', 'Other')
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Giới tính không được vượt quá 10 ký tự',
            'any.only': 'Giới tính phải là một trong các loại sau: Male, Female, Other'
        }),

    relationship: Joi.string()
        .valid('host', 'spouse', 'child', 'parent', 'sibling', 'friend', 'colleague', 'other')
        .optional()
        .allow(null)
        .messages({
            'any.only': 'Relationship must be one of: host, spouse, child, parent, sibling, friend, colleague, other'
        }),

    note: Joi.string()
        .max(255)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Ghi chú không được vượt quá 255 ký tự'
        })
});

// Schema for creating guest registration
const createGuestRegistrationSchema = Joi.object({

    room_id: Joi.number()
        .integer()
        .optional()
        .allow(null)
        .messages({
            'number.integer': 'Room ID phải là số nguyên'
        }),

    arrival_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'Arrival date must be in ISO format (YYYY-MM-DD)'
        }),

    departure_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .greater(Joi.ref('arrival_date'))
        .messages({
            'date.format': 'Departure date must be in ISO format (YYYY-MM-DD)',
            'date.greater': 'Departure date must be after arrival date'
        }),

    note: Joi.string()
        .optional()
        .allow(null, '')
        .max(500)
        .messages({
            'string.max': 'Ghi chú không được vượt quá 500 ký tự'
        }),

    guest_details: Joi.array()
        .items(guestDetailSchema)
        .min(1)
        .required()
        .messages({
            'array.min': 'Ít nhất một chi tiết khách là bắt buộc',
            'any.required': 'Chi tiết khách là bắt buộc',
            'array.base': 'Chi tiết khách phải là một mảng'
        })
}).messages({
    'object.unknown': 'Unknown field: {{#label}}'
});

// Schema for updating guest registration
const updateGuestRegistrationSchema = Joi.object({
    guest_count: Joi.number()
        .integer()
        .min(1)
        .optional()
        .messages({
            'number.min': 'Số lượng khách phải ít nhất là 1',
            'number.integer': 'Số lượng khách phải là số nguyên'
        }),

    room_id: Joi.number()
        .integer()
        .optional()
        .allow(null)
        .messages({
            'number.integer': 'Room ID phải là số nguyên'
        }),

    arrival_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'Arrival date must be in ISO format (YYYY-MM-DD)'
        }),

    departure_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'Departure date must be in ISO format (YYYY-MM-DD)'
        }),

    note: Joi.string()
        .optional()
        .allow(null, '')
        .max(500)
        .messages({
            'string.max': 'Ghi chú không được vượt quá 500 ký tự'
        }),

    guest_details: Joi.array()
        .items(guestDetailSchema)
        .min(1)
        .optional()
        .messages({
            'array.min': 'Ít nhất một chi tiết khách là bắt buộc nếu cập nhật chi tiết khách',
            'array.base': 'Chi tiết khách phải là một mảng'
        })
}).min(1).messages({
    'object.min': 'Ít nhất một trường phải được cung cấp để cập nhật'
});

// Schema for cancelling guest registration
const cancelGuestRegistrationSchema = Joi.object({
    cancellation_reason: Joi.string()
        .max(500)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Lý do hủy không được vượt quá 500 ký tự'
        })
});

// Validation middleware function
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return res.status(400).json({
                success: false,
                message: 'Lỗi dữ liệu',
                errors
            });
        }

        req.body = value;
        next();
    };
};

module.exports = {
    createGuestRegistrationSchema,
    updateGuestRegistrationSchema,
    cancelGuestRegistrationSchema,
    validate
};