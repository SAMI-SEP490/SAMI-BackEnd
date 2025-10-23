// Updated: 2025-10-24
// by: DatNB


const Joi = require('joi');

// Schema for guest detail object
const guestDetailSchema = Joi.object({
    full_name: Joi.string()
        .max(200)
        .required()
        .messages({
            'string.empty': 'Guest full name is required',
            'string.max': 'Guest full name cannot exceed 200 characters',
            'any.required': 'Guest full name is required'
        }),

    id_type: Joi.string()
        .valid('national_id', 'passport', 'other')
        .default('national_id')
        .messages({
            'any.only': 'ID type must be one of: national_id, passport, other'
        }),

    id_number: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'ID number cannot exceed 100 characters'
        }),

    date_of_birth: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .max('now')
        .messages({
            'date.format': 'Date of birth must be in ISO format (YYYY-MM-DD)',
            'date.max': 'Date of birth cannot be in the future'
        }),

    nationality: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Nationality cannot exceed 100 characters'
        }),

    gender: Joi.string()
        .max(10)
        .valid('Male', 'Female', 'Other')
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Gender cannot exceed 10 characters',
            'any.only': 'Gender must be one of: Male, Female, Other'
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
            'string.max': 'Note cannot exceed 255 characters'
        })
});

// Schema for creating guest registration
const createGuestRegistrationSchema = Joi.object({
    guest_count: Joi.number()
        .integer()
        .min(1)
        .optional()
        .messages({
            'number.min': 'Guest count must be at least 1',
            'number.integer': 'Guest count must be an integer'
        }),

    room_id: Joi.number()
        .integer()
        .optional()
        .allow(null)
        .messages({
            'number.integer': 'Room ID must be an integer'
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
            'string.max': 'Note cannot exceed 500 characters'
        }),

    guest_details: Joi.array()
        .items(guestDetailSchema)
        .min(1)
        .required()
        .messages({
            'array.min': 'At least one guest detail is required',
            'any.required': 'Guest details are required',
            'array.base': 'Guest details must be an array'
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
            'number.min': 'Guest count must be at least 1',
            'number.integer': 'Guest count must be an integer'
        }),

    room_id: Joi.number()
        .integer()
        .optional()
        .allow(null)
        .messages({
            'number.integer': 'Room ID must be an integer'
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
            'string.max': 'Note cannot exceed 500 characters'
        }),

    guest_details: Joi.array()
        .items(guestDetailSchema)
        .min(1)
        .optional()
        .messages({
            'array.min': 'At least one guest detail is required if updating guest details',
            'array.base': 'Guest details must be an array'
        })
}).min(1).messages({
    'object.min': 'At least one field must be provided for update'
});

// Schema for cancelling guest registration
const cancelGuestRegistrationSchema = Joi.object({
    cancellation_reason: Joi.string()
        .max(500)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Cancellation reason cannot exceed 500 characters'
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
                message: 'Validation failed',
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