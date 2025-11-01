// Updated: 2025-01-11
// by: DatNB

const validateCreateFloorPlan = (req, res, next) => {
    try {
        const { building_id, name, floor_number, layout, file_url, is_published, note } = req.body;

        // Required fields
        if (!building_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: building_id'
            });
        }

        // Validate building_id
        const buildingId = parseInt(building_id);
        if (isNaN(buildingId) || buildingId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'building_id must be a positive integer'
            });
        }

        // Validate name if provided
        if (name !== undefined && name !== null && name !== '') {
            if (typeof name !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'name must be a string'
                });
            }

            if (name.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'name must not exceed 200 characters'
                });
            }
        }

        // Validate floor_number if provided
        if (floor_number !== undefined && floor_number !== null && floor_number !== '') {
            const floor = parseInt(floor_number);
            if (isNaN(floor)) {
                return res.status(400).json({
                    success: false,
                    message: 'floor_number must be a valid integer'
                });
            }

            if (floor < -10 || floor > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'floor_number must be between -10 and 200'
                });
            }
        }

        // Validate layout if provided (should be valid JSON)
        if (layout !== undefined && layout !== null) {
            if (typeof layout !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'layout must be a valid JSON object'
                });
            }
        }

        // Validate file_url if provided
        if (file_url !== undefined && file_url !== null && file_url !== '') {
            if (typeof file_url !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must be a string'
                });
            }

            if (file_url.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must not exceed 1000 characters'
                });
            }

            // Basic URL validation
            try {
                new URL(file_url);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must be a valid URL'
                });
            }
        }

        // Validate is_published if provided
        if (is_published !== undefined) {
            if (typeof is_published !== 'boolean' && is_published !== 'true' && is_published !== 'false') {
                return res.status(400).json({
                    success: false,
                    message: 'is_published must be a boolean'
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

const validateUpdateFloorPlan = (req, res, next) => {
    try {
        const { name, layout, file_url, is_published, note } = req.body;

        // Check if at least one field is provided
        if (name === undefined &&
            layout === undefined &&
            file_url === undefined &&
            is_published === undefined &&
            note === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate name if provided
        if (name !== undefined && name !== null && name !== '') {
            if (typeof name !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'name must be a string'
                });
            }

            if (name.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'name must not exceed 200 characters'
                });
            }
        }

        // Validate layout if provided
        if (layout !== undefined && layout !== null) {
            if (typeof layout !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'layout must be a valid JSON object'
                });
            }
        }

        // Validate file_url if provided
        if (file_url !== undefined && file_url !== null && file_url !== '') {
            if (typeof file_url !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must be a string'
                });
            }

            if (file_url.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must not exceed 1000 characters'
                });
            }

            // Basic URL validation
            try {
                new URL(file_url);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'file_url must be a valid URL'
                });
            }
        }

        // Validate is_published if provided
        if (is_published !== undefined) {
            if (typeof is_published !== 'boolean' && is_published !== 'true' && is_published !== 'false') {
                return res.status(400).json({
                    success: false,
                    message: 'is_published must be a boolean'
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

const validateFloorPlanId = (req, res, next) => {
    const { id } = req.params;
    const planId = parseInt(id);

    if (isNaN(planId) || planId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid floor plan ID'
        });
    }

    next();
};

const validateBuildingId = (req, res, next) => {
    const { buildingId } = req.params;
    const buildingIdInt = parseInt(buildingId);

    if (isNaN(buildingIdInt) || buildingIdInt <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid building ID'
        });
    }

    next();
};

const validateFloorNumber = (req, res, next) => {
    const { floorNumber } = req.params;
    const floor = parseInt(floorNumber);

    if (isNaN(floor)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid floor number'
        });
    }

    if (floor < -10 || floor > 200) {
        return res.status(400).json({
            success: false,
            message: 'floor_number must be between -10 and 200'
        });
    }

    next();
};

module.exports = {
    validateCreateFloorPlan,
    validateUpdateFloorPlan,
    validateFloorPlanId,
    validateBuildingId,
    validateFloorNumber
};