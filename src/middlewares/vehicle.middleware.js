// Updated: 2025-11-06
// by: DatNB

const Joi = require('joi');

// Schema for creating vehicle registration
const createVehicleRegistrationSchema = Joi.object({
    type: Joi.string()
        .valid('two-wheeler', 'four-wheeler')
        .required()
        .messages({
            'any.only': 'Vehicle type must be one of: two-wheeler, four-wheeler',
            'any.required': 'Vehicle type is required'
        }),

    license_plate: Joi.string()
        .max(50)
        .required()
        .trim()
        .messages({
            'string.empty': 'License plate is required',
            'string.max': 'License plate cannot exceed 50 characters',
            'any.required': 'License plate is required'
        }),

    brand: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Brand cannot exceed 100 characters'
        }),

    color: Joi.string()
        .max(50)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Color cannot exceed 50 characters'
        }),

    start_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
        }),

    end_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .greater(Joi.ref('start_date'))
        .messages({
            'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
            'date.greater': 'End date must be after start date'
        }),

    note: Joi.string()
        .optional()
        .allow(null, '')
        .max(500)
        .messages({
            'string.max': 'Note cannot exceed 500 characters'
        })
}).messages({
    'object.unknown': 'Unknown field: {{#label}}'
});

// Schema for updating vehicle registration
const updateVehicleRegistrationSchema = Joi.object({
    type: Joi.string()
        .valid('car', 'motorcycle', 'truck', 'van', 'other')
        .optional()
        .messages({
            'any.only': 'Vehicle type must be one of: car, motorcycle, truck, van, other'
        }),

    license_plate: Joi.string()
        .max(50)
        .optional()
        .trim()
        .messages({
            'string.empty': 'License plate cannot be empty',
            'string.max': 'License plate cannot exceed 50 characters'
        }),

    brand: Joi.string()
        .max(100)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Brand cannot exceed 100 characters'
        }),

    color: Joi.string()
        .max(50)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Color cannot exceed 50 characters'
        }),

    start_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
        }),

    end_date: Joi.date()
        .iso()
        .optional()
        .allow(null)
        .messages({
            'date.format': 'End date must be in ISO format (YYYY-MM-DD)'
        }),

    note: Joi.string()
        .optional()
        .allow(null, '')
        .max(500)
        .messages({
            'string.max': 'Note cannot exceed 500 characters'
        })
}).min(1).messages({
    'object.min': 'At least one field must be provided for update'
});

// Schema for cancelling vehicle registration
const cancelVehicleRegistrationSchema = Joi.object({
    cancellation_reason: Joi.string()
        .max(300)
        .optional()
        .allow(null, '')
        .messages({
            'string.max': 'Cancellation reason cannot exceed 300 characters'
        })
});
const approveVehicleRegistrationSchema = Joi.object({
    slot_id: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'slot_id is required',
            'number.base': 'slot_id must be a number',
            'number.integer': 'slot_id must be an integer',
            'number.positive': 'slot_id must be a positive number'
        })
});
const assignVehicleSlotSchema = Joi.object({
    slot_id: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'slot_id is required'
        })
});
const changeVehicleSlotSchema = Joi.object({
    slot_id: Joi.number()
        .integer()
        .positive()
        .required()
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
    createVehicleRegistrationSchema,
    updateVehicleRegistrationSchema,
    cancelVehicleRegistrationSchema,
    approveVehicleRegistrationSchema,
    assignVehicleSlotSchema,
    changeVehicleSlotSchema,
    validate
};