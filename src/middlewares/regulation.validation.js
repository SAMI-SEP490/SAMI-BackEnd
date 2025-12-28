// Updated: 2025-11-22
// by: DatNB

const validateCreateRegulation = (req, res, next) => {
    try {
        const {
            title,
            content,
            building_id,
            effective_date,
            status,
            target,
            note
        } = req.body;

        // Required fields
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: title'
            });
        }

        // Validate title
        if (typeof title !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'title must be a string'
            });
        }

        if (title.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'title cannot be empty'
            });
        }

        if (title.length > 255) {
            return res.status(400).json({
                success: false,
                message: 'title must not exceed 255 characters'
            });
        }

        // Validate content if provided
        if (content !== undefined && content !== null && content !== '') {
            if (typeof content !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'content must be a string'
                });
            }
        }

        // Validate building_id if provided
        if (building_id !== undefined && building_id !== null && building_id !== '') {
            const buildingId = parseInt(building_id);
            if (isNaN(buildingId) || buildingId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'building_id must be a positive integer'
                });
            }
        }

        // Validate effective_date if provided
        if (effective_date !== undefined && effective_date !== null && effective_date !== '') {
            const date = new Date(effective_date);
            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'effective_date must be a valid date'
                });
            }
        }

        // Validate status if provided
        if (status !== undefined && status !== null && status !== '') {
            const validStatuses = ['draft', 'published', 'deleted'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `status must be one of: ${validStatuses.join(', ')}`
                });
            }
        }

        // Validate target if provided
        if (target !== undefined && target !== null && target !== '') {
            const validTargets = ['all', 'tenants', 'management'];
            if (!validTargets.includes(target)) {
                return res.status(400).json({
                    success: false,
                    message: `target must be one of: ${validTargets.join(', ')}`
                });
            }
        }

        // Validate note if provided
        if (note !== undefined && note !== null && note !== '') {
            if (typeof note !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'note must be a string'
                });
            }
        }

        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: 'Validation error: ' + error.message
        });
    }
};

const validateUpdateRegulation = (req, res, next) => {
    try {
        const {
            title,
            content,
            effective_date,
            status,
            target,
            note
        } = req.body;

        // Check if at least one field is provided
        if (title === undefined &&
            content === undefined &&
            effective_date === undefined &&
            status === undefined &&
            target === undefined &&
            note === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate title if provided
        if (title !== undefined && title !== null && title !== '') {
            if (typeof title !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'title must be a string'
                });
            }

            if (title.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'title cannot be empty'
                });
            }

            if (title.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'title must not exceed 255 characters'
                });
            }
        }

        // Validate content if provided
        if (content !== undefined && content !== null && content !== '') {
            if (typeof content !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'content must be a string'
                });
            }
        }

        // Validate effective_date if provided
        if (effective_date !== undefined && effective_date !== null && effective_date !== '') {
            const date = new Date(effective_date);
            if (isNaN(date.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'effective_date must be a valid date'
                });
            }
        }

        // Validate status if provided
        if (status !== undefined && status !== null && status !== '') {
            const validStatuses = ['draft', 'published', 'deleted'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `status must be one of: ${validStatuses.join(', ')}`
                });
            }
        }

        // Validate target if provided
        if (target !== undefined && target !== null && target !== '') {
            const validTargets = ['all', 'tenants', 'management'];
            if (!validTargets.includes(target)) {
                return res.status(400).json({
                    success: false,
                    message: `target must be one of: ${validTargets.join(', ')}`
                });
            }
        }

        // Validate note if provided
        if (note !== undefined && note !== null && note !== '') {
            if (typeof note !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'note must be a string'
                });
            }
        }

        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: 'Validation error: ' + error.message
        });
    }
};

const validateRegulationId = (req, res, next) => {
    const { id } = req.params;
    const regulationId = parseInt(id);

    if (isNaN(regulationId) || regulationId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid regulation ID'
        });
    }

    next();
};

const validateBuildingId = (req, res, next) => {
    const { buildingId } = req.params;

    // Allow 'null' string for global regulations
    if (buildingId === 'null') {
        return next();
    }

    const buildingIdInt = parseInt(buildingId);

    if (isNaN(buildingIdInt) || buildingIdInt <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid building ID'
        });
    }

    next();
};

const validateAddFeedback = (req, res, next) => {
    try {
        const { comment } = req.body;

        // Comment is optional but if provided must be a string
        if (comment !== undefined && comment !== null && comment !== '') {
            if (typeof comment !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'comment must be a string'
                });
            }

            if (comment.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'comment must not exceed 1000 characters'
                });
            }
        }

        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: 'Validation error: ' + error.message
        });
    }
};

module.exports = {
    validateCreateRegulation,
    validateUpdateRegulation,
    validateRegulationId,
    validateBuildingId,
    validateAddFeedback
};