// Updated: 2025-11-06
// by: DatNB

const Joi = require('joi');

// Schema for creating vehicle registration
const createVehicleRegistrationSchema = Joi.object({
    vehicle_type: Joi.string()
        .valid('two_wheeler', 'four_wheeler')
        .required(),

    license_plate: Joi.string()
        .trim()
        .max(50)
        .required(),

    brand: Joi.string()
        .trim()
        .max(100)
        .optional()
        .allow(null, ''),

    color: Joi.string()
        .trim()
        .max(50)
        .optional()
        .allow(null, ''),

    start_date: Joi.date()
        .iso()
        .required()
        .default(() => new Date()),

    end_date: Joi.date()
        .iso()
        .required()
        .greater(Joi.ref('start_date')),

    note: Joi.string()
        .trim()
        .max(500)
        .optional()
        .allow(null, '')
})
.options({
    abortEarly: false,
    allowUnknown: false
});
    

// Schema for updating vehicle registration
const updateVehicleRegistrationSchema = Joi.object({
    vehicle_type: Joi.string()
        .valid('two_wheeler', 'four_wheeler')
        .optional(),

    license_plate: Joi.string()
        .max(50)
        .optional()
        .trim(),

    brand: Joi.string()
        .max(100)
        .optional()
        .allow(null, ''),

    color: Joi.string()
        .max(50)
        .optional()
        .allow(null, ''),

    start_date: Joi.date()
        .iso()
        .optional(),

    end_date: Joi.date()
        .iso()
        .optional()   // 👈 KHÔNG required ở đây
        .messages({
            'date.format': 'End date must be in ISO format'
        }),

    note: Joi.string()
        .optional()
        .allow(null, '')
        .max(500)
})
.min(1)
.custom((value, helpers) => {
    // Sau update, end_date PHẢI tồn tại

    const hasEndDate =
        value.end_date !== undefined ||
        helpers.state.ancestors[0]?.end_date !== null;

    if (!hasEndDate) {
        return helpers.error('any.custom', {
            message: 'End date is required for vehicle registration'
        });
    }

    return value;
})
.messages({
    'any.custom': '{{#message}}',
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
                message: 'Lỗi dữ liệu',
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