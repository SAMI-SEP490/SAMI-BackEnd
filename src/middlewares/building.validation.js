// Updated: 2025-31-10
// by: DatNB

const validateCreateBuilding = (req, res, next) => {
    try {
        const { name, address, number_of_floors, total_area } = req.body;

        // Required fields
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: name'
            });
        }

        // Validate name length
        if (name.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'name must not exceed 200 characters'
            });
        }

        // Validate address if provided
        if (address !== undefined && address !== null) {
            if (typeof address !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'address must be a string'
                });
            }

            if (address.length > 300) {
                return res.status(400).json({
                    success: false,
                    message: 'address must not exceed 300 characters'
                });
            }
        }

        // Validate number_of_floors if provided
        if (number_of_floors !== undefined && number_of_floors !== null && number_of_floors !== '') {
            const floors = parseInt(number_of_floors);
            if (isNaN(floors) || floors <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'number_of_floors must be a positive integer'
                });
            }

            if (floors > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'number_of_floors seems unrealistic (max 200)'
                });
            }
        }

        // Validate total_area if provided
        if (total_area !== undefined && total_area !== null && total_area !== '') {
            const area = parseFloat(total_area);
            if (isNaN(area) || area <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'total_area must be a positive number'
                });
            }

            if (area > 1000000) {
                return res.status(400).json({
                    success: false,
                    message: 'total_area seems unrealistic (max 1,000,000 sq m)'
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

const validateUpdateBuilding = (req, res, next) => {
    try {
        const { name, address, number_of_floors, total_area, is_active } = req.body;

        // Check if at least one field is provided
        if (name === undefined &&
            address === undefined &&
            number_of_floors === undefined &&
            total_area === undefined &&
            is_active === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate name if provided
        if (name !== undefined) {
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'name must be a non-empty string'
                });
            }

            if (name.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'name must not exceed 200 characters'
                });
            }
        }

        // Validate address if provided
        if (address !== undefined && address !== null && address !== '') {
            if (typeof address !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'address must be a string'
                });
            }

            if (address.length > 300) {
                return res.status(400).json({
                    success: false,
                    message: 'address must not exceed 300 characters'
                });
            }
        }

        // Validate number_of_floors if provided
        if (number_of_floors !== undefined && number_of_floors !== null && number_of_floors !== '') {
            const floors = parseInt(number_of_floors);
            if (isNaN(floors) || floors <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'number_of_floors must be a positive integer'
                });
            }

            if (floors > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'number_of_floors seems unrealistic (max 200)'
                });
            }
        }

        // Validate total_area if provided
        if (total_area !== undefined && total_area !== null && total_area !== '') {
            const area = parseFloat(total_area);
            if (isNaN(area) || area <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'total_area must be a positive number'
                });
            }

            if (area > 1000000) {
                return res.status(400).json({
                    success: false,
                    message: 'total_area seems unrealistic (max 1,000,000 sq m)'
                });
            }
        }

        // Validate is_active if provided
        if (is_active !== undefined) {
            if (typeof is_active !== 'boolean' && is_active !== 'true' && is_active !== 'false') {
                return res.status(400).json({
                    success: false,
                    message: 'is_active must be a boolean'
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

const validateBuildingId = (req, res, next) => {
    const { id } = req.params;
    const buildingId = parseInt(id);

    if (isNaN(buildingId) || buildingId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid building ID'
        });
    }

    next();
};

const validateAssignManager = (req, res, next) => {
    try {
        const { user_id, assigned_from, assigned_to, note } = req.body;

        // Required field
        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: user_id'
            });
        }

        // Validate user_id
        const userId = parseInt(user_id);
        if (isNaN(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'user_id must be a valid positive number'
            });
        }

        // Validate assigned_from if provided
        if (assigned_from !== undefined && assigned_from !== null && assigned_from !== '') {
            const assignedFromDate = new Date(assigned_from);
            if (isNaN(assignedFromDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'assigned_from is not a valid date'
                });
            }
        }

        // Validate assigned_to if provided
        if (assigned_to !== undefined && assigned_to !== null && assigned_to !== '') {
            const assignedToDate = new Date(assigned_to);
            if (isNaN(assignedToDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'assigned_to is not a valid date'
                });
            }

            // Check if assigned_to is after assigned_from
            if (assigned_from) {
                const assignedFromDate = new Date(assigned_from);
                if (assignedToDate <= assignedFromDate) {
                    return res.status(400).json({
                        success: false,
                        message: 'assigned_to must be after assigned_from'
                    });
                }
            }
        }

        // Validate note if provided
        if (note !== undefined && note !== null) {
            if (typeof note !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'note must be a string'
                });
            }

            if (note.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'note must not exceed 255 characters'
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

const validateUpdateManagerAssignment = (req, res, next) => {
    try {
        const { assigned_from, assigned_to, note } = req.body;

        // Check if at least one field is provided
        if (assigned_from === undefined &&
            assigned_to === undefined &&
            note === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate assigned_from if provided
        if (assigned_from !== undefined && assigned_from !== null && assigned_from !== '') {
            const assignedFromDate = new Date(assigned_from);
            if (isNaN(assignedFromDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'assigned_from is not a valid date'
                });
            }
        }

        // Validate assigned_to if provided
        if (assigned_to !== undefined && assigned_to !== null && assigned_to !== '') {
            const assignedToDate = new Date(assigned_to);
            if (isNaN(assignedToDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'assigned_to is not a valid date'
                });
            }

            // Check if assigned_to is after assigned_from
            if (assigned_from) {
                const assignedFromDate = new Date(assigned_from);
                if (assignedToDate <= assignedFromDate) {
                    return res.status(400).json({
                        success: false,
                        message: 'assigned_to must be after assigned_from'
                    });
                }
            }
        }

        // Validate note if provided
        if (note !== undefined && note !== null) {
            if (typeof note !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'note must be a string'
                });
            }

            if (note.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'note must not exceed 255 characters'
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

const validateUserId = (req, res, next) => {
    const { userId } = req.params;
    const userIdInt = parseInt(userId);

    if (isNaN(userIdInt) || userIdInt <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid user ID'
        });
    }

    next();
};

module.exports = {
    validateCreateBuilding,
    validateUpdateBuilding,
    validateBuildingId,
    validateAssignManager,
    validateUpdateManagerAssignment,
    validateUserId
};