// middlewares/bot.validation.js
// Validation cho bot maintenance request

const validateBotMaintenanceRequest = (req, res, next) => {
    const { tenant_user_id, title, description, category, priority, room_id } = req.body;
    const errors = [];

    // Required fields
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    if (!title || title.trim().length === 0) {
        errors.push('title is required and cannot be empty');
    } else if (title.length > 200) {
        errors.push('title must not exceed 200 characters');
    }

    // Optional fields validation
    if (description && description.length > 2000) {
        errors.push('description must not exceed 2000 characters');
    }

    if (category) {
        const validCategories = [
            'plumbing',
            'electrical',
            'hvac',
            'appliance',
            'structural',
            'cleaning',
            'other'
        ];
        if (!validCategories.includes(category)) {
            errors.push(`category must be one of: ${validCategories.join(', ')}`);
        }
    }

    if (priority) {
        const validPriorities = ['low', 'normal', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
            errors.push(`priority must be one of: ${validPriorities.join(', ')}`);
        }
    }

    if (room_id !== undefined && room_id !== null) {
        if (!Number.isInteger(room_id)) {
            errors.push('room_id must be an integer');
        }
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};

const validateBotMaintenanceUpdate = (req, res, next) => {
    const { tenant_user_id, title, description, category, priority, room_id } = req.body;
    const errors = [];

    // tenant_user_id is required for update (to verify ownership)
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    // Optional fields validation (at least one should be provided)
    if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
            errors.push('title cannot be empty');
        } else if (title.length > 200) {
            errors.push('title must not exceed 200 characters');
        }
    }

    if (description !== undefined && description !== null) {
        if (typeof description !== 'string') {
            errors.push('description must be a string');
        } else if (description.length > 2000) {
            errors.push('description must not exceed 2000 characters');
        }
    }

    if (category !== undefined && category !== null) {
        const validCategories = [
            'plumbing',
            'electrical',
            'hvac',
            'appliance',
            'structural',
            'cleaning',
            'other'
        ];
        if (!validCategories.includes(category)) {
            errors.push(`category must be one of: ${validCategories.join(', ')}`);
        }
    }

    if (priority !== undefined && priority !== null) {
        const validPriorities = ['low', 'normal', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
            errors.push(`priority must be one of: ${validPriorities.join(', ')}`);
        }
    }

    if (room_id !== undefined && room_id !== null) {
        if (!Number.isInteger(room_id)) {
            errors.push('room_id must be an integer');
        }
    }

    // Check if at least one field is being updated
    const hasUpdates = title !== undefined ||
        description !== undefined ||
        category !== undefined ||
        priority !== undefined ||
        room_id !== undefined;

    if (!hasUpdates) {
        errors.push('At least one field must be provided for update');
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};

const validateBotMaintenanceDelete = (req, res, next) => {
    const { tenant_user_id } = req.body;
    const errors = [];

    // tenant_user_id is required for delete (to verify ownership)
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};
const validateBotVehicleRegistration = (req, res, next) => {
    const {
        tenant_user_id,
        type,
        license_plate,
        brand,
        color,
        start_date,
        end_date,
        note
    } = req.body;
    const errors = [];

    // Required fields
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    if (!type || type.trim().length === 0) {
        errors.push('type is required and cannot be empty');
    } else {
        const validTypes = ['car', 'motorcycle', 'bicycle', 'electric_bike', 'other'];
        if (!validTypes.includes(type)) {
            errors.push(`type must be one of: ${validTypes.join(', ')}`);
        }
    }

    if (!license_plate || license_plate.trim().length === 0) {
        errors.push('license_plate is required and cannot be empty');
    } else if (license_plate.length > 20) {
        errors.push('license_plate must not exceed 20 characters');
    }

    // Optional fields validation
    if (brand && brand.length > 100) {
        errors.push('brand must not exceed 100 characters');
    }

    if (color && color.length > 50) {
        errors.push('color must not exceed 50 characters');
    }

    if (note && note.length > 500) {
        errors.push('note must not exceed 500 characters');
    }

    // Date validation
    if (start_date && end_date) {
        const start = new Date(start_date);
        const end = new Date(end_date);

        if (isNaN(start.getTime())) {
            errors.push('start_date is not a valid date');
        }

        if (isNaN(end.getTime())) {
            errors.push('end_date is not a valid date');
        }

        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
            errors.push('end_date must be after start_date');
        }
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};

const validateBotVehicleUpdate = (req, res, next) => {
    const {
        tenant_user_id,
        type,
        license_plate,
        brand,
        color,
        start_date,
        end_date,
        note
    } = req.body;
    const errors = [];

    // tenant_user_id is required for update (to verify ownership)
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    // Optional fields validation
    if (type !== undefined) {
        const validTypes = ['car', 'motorcycle', 'bicycle', 'electric_bike', 'other'];
        if (!validTypes.includes(type)) {
            errors.push(`type must be one of: ${validTypes.join(', ')}`);
        }
    }

    if (license_plate !== undefined) {
        if (typeof license_plate !== 'string' || license_plate.trim().length === 0) {
            errors.push('license_plate cannot be empty');
        } else if (license_plate.length > 20) {
            errors.push('license_plate must not exceed 20 characters');
        }
    }

    if (brand !== undefined && brand !== null) {
        if (typeof brand !== 'string') {
            errors.push('brand must be a string');
        } else if (brand.length > 100) {
            errors.push('brand must not exceed 100 characters');
        }
    }

    if (color !== undefined && color !== null) {
        if (typeof color !== 'string') {
            errors.push('color must be a string');
        } else if (color.length > 50) {
            errors.push('color must not exceed 50 characters');
        }
    }

    if (note !== undefined && note !== null) {
        if (typeof note !== 'string') {
            errors.push('note must be a string');
        } else if (note.length > 500) {
            errors.push('note must not exceed 500 characters');
        }
    }

    // Date validation
    if (start_date !== undefined || end_date !== undefined) {
        if (start_date !== undefined) {
            const start = new Date(start_date);
            if (isNaN(start.getTime())) {
                errors.push('start_date is not a valid date');
            }
        }

        if (end_date !== undefined) {
            const end = new Date(end_date);
            if (isNaN(end.getTime())) {
                errors.push('end_date is not a valid date');
            }
        }
    }

    // Check if at least one field is being updated
    const hasUpdates = type !== undefined ||
        license_plate !== undefined ||
        brand !== undefined ||
        color !== undefined ||
        start_date !== undefined ||
        end_date !== undefined ||
        note !== undefined;

    if (!hasUpdates) {
        errors.push('At least one field must be provided for update');
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};

const validateBotVehicleDelete = (req, res, next) => {
    const { tenant_user_id } = req.body;
    const errors = [];

    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};

const validateBotVehicleCancel = (req, res, next) => {
    const { tenant_user_id, cancellation_reason } = req.body;
    const errors = [];

    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    if (cancellation_reason && typeof cancellation_reason !== 'string') {
        errors.push('cancellation_reason must be a string');
    }

    if (cancellation_reason && cancellation_reason.length > 500) {
        errors.push('cancellation_reason must not exceed 500 characters');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};
const validateBotRegulationFeedback = (req, res, next) => {
    const { tenant_user_id, comment } = req.body;
    const errors = [];

    // Required fields
    if (!tenant_user_id) {
        errors.push('tenant_user_id is required');
    } else if (!Number.isInteger(tenant_user_id)) {
        errors.push('tenant_user_id must be an integer');
    }

    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        errors.push('comment is required and cannot be empty');
    } else if (comment.length > 1000) {
        errors.push('comment must not exceed 1000 characters');
    }

    // Return errors if any
    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors
        });
    }

    next();
};
module.exports = {
    validateBotMaintenanceRequest,
    validateBotMaintenanceUpdate,
    validateBotMaintenanceDelete,
    validateBotVehicleRegistration,
    validateBotVehicleUpdate,
    validateBotVehicleDelete,
    validateBotVehicleCancel,
    validateBotRegulationFeedback
};