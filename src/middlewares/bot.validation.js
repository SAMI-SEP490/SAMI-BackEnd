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

module.exports = {
    validateBotMaintenanceRequest,
    validateBotMaintenanceUpdate,
    validateBotMaintenanceDelete
};