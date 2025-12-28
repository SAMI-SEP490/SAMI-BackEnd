// Updated: 2025-31-10
// By: DatNB

const { body, param, validationResult } = require('express-validator');

// Validate maintenance request ID
const validateMaintenanceRequestId = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('Invalid maintenance request ID'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

// Validate create maintenance request
const validateCreateMaintenanceRequest = [
    body('title')
        .notEmpty()
        .withMessage('Title is required')
        .isLength({ max: 200 })
        .withMessage('Title must not exceed 200 characters'),

    body('description')
        .optional()
        .isString()
        .withMessage('Description must be a string'),

    body('room_id')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Invalid room ID'),

    body('category')
        .optional()
        .isIn(['plumbing', 'electrical', 'hvac', 'carpentry', 'cleaning', 'other'])
        .withMessage('Invalid category'),

    body('priority')
        .optional()
        .isIn(['low', 'normal', 'high', 'urgent'])
        .withMessage('Invalid priority'),

    body('note')
        .optional()
        .isString()
        .withMessage('Note must be a string'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

// Validate update maintenance request
const validateUpdateMaintenanceRequest = [
    body('title')
        .optional()
        .notEmpty()
        .withMessage('Title cannot be empty')
        .isLength({ max: 200 })
        .withMessage('Title must not exceed 200 characters'),

    body('description')
        .optional()
        .isString()
        .withMessage('Description must be a string'),

    body('category')
        .optional()
        .isIn(['plumbing', 'electrical', 'hvac', 'carpentry', 'cleaning', 'structural', 'other'])
        .withMessage('Invalid category'),

    body('priority')
        .optional()
        .isIn(['low', 'normal', 'high', 'urgent'])
        .withMessage('Invalid priority'),

    body('status')
        .optional()
        .isIn(['pending', 'in_progress', 'on_hold', 'resolved', 'completed', 'cancelled', 'rejected'])
        .withMessage('Invalid status'),

    body('note')
        .optional()
        .isString()
        .withMessage('Note must be a string'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

// Validate reject maintenance request
const validateRejectMaintenanceRequest = [
    body('reason')
        .optional()
        .isString()
        .withMessage('Reason must be a string'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

// Validate room ID param
const validateRoomId = [
    param('roomId')
        .isInt({ min: 1 })
        .withMessage('Invalid room ID'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

module.exports = {
    validateMaintenanceRequestId,
    validateCreateMaintenanceRequest,
    validateUpdateMaintenanceRequest,
    validateRejectMaintenanceRequest,
    validateRoomId
};
