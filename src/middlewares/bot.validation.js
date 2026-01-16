// middlewares/bot.validation.js
// Validation cho bot maintenance request

const validateBotMaintenanceRequest = (req, res, next) => {
    const { tenant_user_id, title, description, category, priority, room_id } = req.body;
    const errors = [];

    // 1. Critical Identity Checks (Must fail if missing)
    if (!tenant_user_id) errors.push('tenant_user_id is required');
    if (!Number.isInteger(tenant_user_id)) errors.push('tenant_user_id must be an integer');

    if (!title || typeof title !== 'string' || !title.trim()) {
        errors.push('title is required');
    }

    // 2. Safety Checks (Data Integrity)
    if (title && title.length > 200) errors.push('title must be under 200 chars');
    if (description && description.length > 2000) errors.push('description must be under 2000 chars');

    // 3. Enum Checks (Lenient: Only validate IF provided)
    if (category) {
        const validCategories = ['plumbing', 'electrical', 'hvac', 'carpentry', 'structural', 'cleaning', 'other'];
        // Allow bot to send Case-Insensitive, we fix it here or in service
        if (!validCategories.includes(category.toLowerCase())) {
            // Option A: Reject (Strict)
            // errors.push(`Invalid category: ${category}`);

            // Option B: Heal (Recommended for Bots)
            // Just warn or set to 'other' in the controller. 
            // For now, let's keep it strict if you prefer:
            errors.push(`category must be one of: ${validCategories.join(', ')}`);
        }
    }

    if (priority) {
        const validPriorities = ['low', 'normal', 'high', 'urgent'];
        if (!validPriorities.includes(priority.toLowerCase())) {
            errors.push(`priority must be one of: ${validPriorities.join(', ')}`);
        }
    }

    // 4. Room ID is OPTIONAL now, but if sent, must be int
    if (room_id !== undefined && room_id !== null) {
        if (!Number.isInteger(Number(room_id))) {
            errors.push('room_id must be an integer');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ success: false, message: 'Bot Validation Failed', errors });
    }
    next();
};

const validateBotMaintenanceUpdate = (req, res, next) => {
    const { tenant_user_id, title, description } = req.body;
    const errors = [];

    if (!tenant_user_id || !Number.isInteger(tenant_user_id)) {
        return res.status(400).json({ success: false, message: 'tenant_user_id is required' });
    }

    // Safety checks
    if (title && title.length > 200) errors.push('title too long');
    if (description && description.length > 2000) errors.push('description too long');

    if (errors.length > 0) {
        return res.status(400).json({ success: false, message: 'Bot Validation Failed', errors });
    }
    next();
};

const validateBotMaintenanceDelete = (req, res, next) => {
    const { tenant_user_id } = req.body;
    if (!tenant_user_id || !Number.isInteger(tenant_user_id)) {
        return res.status(400).json({ success: false, message: 'tenant_user_id is required' });
    }
    next();
};

const validateBotVehicleRegistration = (req, res, next) => {
    const { tenant_user_id, type, license_plate } = req.body;
    const errors = [];

    // 1. Critical
    if (!tenant_user_id) errors.push('tenant_user_id is required');
    if (!Number.isInteger(tenant_user_id)) errors.push('tenant_user_id must be an integer');

    // 2. Required Data
    if (!type) errors.push('type is required');
    if (!license_plate) errors.push('license_plate is required');

    // 3. Enum Check (Lenient/Healing)
    if (type) {
        const validTypes = ['two_wheeler', 'four_wheeler'];
        // Map common bot inputs to schema enums if possible
        // e.g. 'car' -> 'four_wheeler', 'bike' -> 'two_wheeler'
        // For validation, we just check if it's broadly valid or let Service handle mapping
        if (!validTypes.includes(type) && !['car', 'motorcycle', 'bike'].includes(type)) {
            // Let it slide or warn? Let's check strictly against schema for now:
            // But usually Dify might send 'car'. You might want to map this in Controller/Service.
            // For validation:
            // errors.push('Invalid type'); 
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ success: false, message: 'Bot Validation Failed', errors });
    }
    next();
};

const validateBotVehicleUpdate = (req, res, next) => {
    const { tenant_user_id } = req.body;
    if (!tenant_user_id) {
        return res.status(400).json({ success: false, message: 'tenant_user_id is required' });
    }
    next();
};

const validateBotVehicleCancel = (req, res, next) => {
    const { tenant_user_id } = req.body;
    if (!tenant_user_id) {
        return res.status(400).json({ success: false, message: 'tenant_user_id is required' });
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
    validateBotVehicleCancel,
    validateBotRegulationFeedback
};