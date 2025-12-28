// Updated: 2025-11-06
// by: DatNB

const validateCreateRoom = (req, res, next) => {
    try {
        const { building_id, room_number, floor, size, description, status } = req.body;

        // Required fields
        if (!building_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: building_id'
            });
        }

        if (!room_number || room_number.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: room_number'
            });
        }

        // Validate building_id
        const buildingId = parseInt(building_id);
        if (isNaN(buildingId) || buildingId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'building_id must be a valid positive number'
            });
        }

        // Validate room_number
        if (room_number.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'room_number must not exceed 50 characters'
            });
        }

        // Validate floor if provided
        if (floor !== undefined && floor !== null && floor !== '') {
            const floorNum = parseInt(floor);
            if (isNaN(floorNum)) {
                return res.status(400).json({
                    success: false,
                    message: 'floor must be a valid number'
                });
            }

            if (floorNum < -5 || floorNum > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'floor must be between -5 and 200'
                });
            }
        }

        // Validate size if provided
        if (size !== undefined && size !== null && size !== '') {
            if (typeof size !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'size must be a string'
                });
            }

            if (size.length > 50) {
                return res.status(400).json({
                    success: false,
                    message: 'size must not exceed 50 characters'
                });
            }
        }

        // Validate description if provided
        if (description !== undefined && description !== null && description !== '') {
            if (typeof description !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'description must be a string'
                });
            }

            if (description.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'description must not exceed 1000 characters'
                });
            }
        }

        // Validate status if provided
        if (status !== undefined && status !== null) {
            const validStatuses = ['available', 'occupied', 'maintenance', 'reserved'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `status must be one of: ${validStatuses.join(', ')}`
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

const validateUpdateRoom = (req, res, next) => {
    try {
        const { room_number, floor, size, description, status, is_active } = req.body;

        // Check if at least one field is provided
        if (room_number === undefined &&
            floor === undefined &&
            size === undefined &&
            description === undefined &&
            status === undefined &&
            is_active === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate room_number if provided
        if (room_number !== undefined) {
            if (!room_number || typeof room_number !== 'string' || room_number.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'room_number must be a non-empty string'
                });
            }

            if (room_number.length > 50) {
                return res.status(400).json({
                    success: false,
                    message: 'room_number must not exceed 50 characters'
                });
            }
        }

        // Validate floor if provided
        if (floor !== undefined && floor !== null && floor !== '') {
            const floorNum = parseInt(floor);
            if (isNaN(floorNum)) {
                return res.status(400).json({
                    success: false,
                    message: 'floor must be a valid number'
                });
            }

            if (floorNum < -5 || floorNum > 200) {
                return res.status(400).json({
                    success: false,
                    message: 'floor must be between -5 and 200'
                });
            }
        }

        // Validate size if provided
        if (size !== undefined && size !== null && size !== '') {
            if (typeof size !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'size must be a string'
                });
            }

            if (size.length > 50) {
                return res.status(400).json({
                    success: false,
                    message: 'size must not exceed 50 characters'
                });
            }
        }

        // Validate description if provided
        if (description !== undefined && description !== null && description !== '') {
            if (typeof description !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'description must be a string'
                });
            }

            if (description.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'description must not exceed 1000 characters'
                });
            }
        }

        // Validate status if provided
        if (status !== undefined && status !== null) {
            const validStatuses = ['available', 'occupied', 'maintenance', 'reserved'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `status must be one of: ${validStatuses.join(', ')}`
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

const validateRoomId = (req, res, next) => {
    const { id } = req.params;
    const roomId = parseInt(id);

    if (isNaN(roomId) || roomId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid room ID'
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
const validateUserID = (req, res, next) =>{
const { userId } = req.params;
const userIdInt = parseInt(userId);

if (isNaN(userId) || userIdInt <= 0) {
    return res.status(400).json({
        success: false,
        message: 'Invalid building ID'
    });
}
next();
};
module.exports = {
    validateCreateRoom,
    validateUpdateRoom,
    validateRoomId,
    validateBuildingId,
    validateUserID
};