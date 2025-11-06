// Updated: 2025-11-06
// by: DatNB
const Joi = require('joi');

// Schema for registering vehicle
const registerVehicleSchema = Joi.object({
    type: Joi.string()
        .valid('car', 'motorcycle', 'truck', 'van', 'other')
        .required()
        .messages({
            'any.only': 'Vehicle type must be one of: car, motorcycle, truck, van, other',
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

    note: Joi.string()
        .optional()
        .allow(null, '')
        .messages({
            'string.base': 'Note must be a string'
        })
}).messages({
    'object.unknown': 'Unknown field: {{#label}}'
});

// Schema for updating vehicle
const updateVehicleSchema = Joi.object({
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

    note: Joi.string()
        .optional()
        .allow(null, '')
        .messages({
            'string.base': 'Note must be a string'
        })
}).min(1).messages({
    'object.min': 'At least one field must be provided for update'
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
    registerVehicleSchema,
    updateVehicleSchema,
    validate
};