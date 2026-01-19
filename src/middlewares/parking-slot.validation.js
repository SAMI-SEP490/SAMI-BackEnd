const validateCreateParkingSlot = (req, res, next) => {
    try {
        const { building_id, slot_number, slot_type, is_available } = req.body;

        // Required fields
        if (!building_id) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn tòa nhà'
            });
        }

        if (!slot_number || slot_number.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập mã chỗ đỗ'
            });
        }
        if ( slot_number.trim().length >= 10) {
            return res.status(400).json({
                success: false,
                message: 'Mã chỗ đỗ không được vượt quá 10 ký tự'
            });
        }
        if (!slot_type) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn loại xe'
            });
        }

        // Validate building_id
        const buildingId = parseInt(building_id);
        if (isNaN(buildingId) || buildingId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Tòa nhà không hợp lệ'
            });
        }

        // Validate slot_number
        if (typeof slot_number !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Mã chỗ đỗ phải là chuỗi ký tự'
            });
        }

        // Business rule: avoid weird slot code
        const slotCodeRegex = /^[A-Za-z0-9_-]+$/;
        if (!slotCodeRegex.test(slot_number)) {
            return res.status(400).json({
                success: false,
                message: 'Mã chỗ đỗ chứa ký tự không hợp lệ'
            });
        }

        // Validate slot_type (enum vehicle_type)
        const allowedTypes = ['two_wheeler', 'four_wheeler'];
        if (!allowedTypes.includes(slot_type)) {
            return res.status(400).json({
                success: false,
                message: `Kiểu chỗ đỗ phải là một trong các loại sau: ${allowedTypes.join(', ')}`
            });
        }

        // Validate is_available if provided
        if (is_available !== undefined) {
            if (typeof is_available !== 'boolean' &&
                is_available !== 'true' &&
                is_available !== 'false') {
                return res.status(400).json({
                    success: false,
                    message: 'is_available must be a boolean'
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

const validateUpdateParkingSlot = (req, res, next) => {
    try {
        const { slot_number, slot_type, is_available } = req.body;

        // At least one field required
        if (
            slot_number === undefined &&
            slot_type === undefined &&
            is_available === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate slot_number if provided
        if (slot_number !== undefined) {
            if (!slot_number || typeof slot_number !== 'string' || slot_number.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'slot_number must be a non-empty string'
                });
            }

            if (slot_number.length > 50) {
                return res.status(400).json({
                    success: false,
                    message: 'slot_number must not exceed 50 characters'
                });
            }

            const slotCodeRegex = /^[A-Za-z0-9_-]+$/;
            if (!slotCodeRegex.test(slot_number)) {
                return res.status(400).json({
                    success: false,
                    message: 'slot_number contains invalid characters'
                });
            }
        }

        // Validate slot_type if provided
        if (slot_type !== undefined) {
            const allowedTypes = ['two_wheeler', 'four_wheeler'];
            if (!allowedTypes.includes(slot_type)) {
                return res.status(400).json({
                    success: false,
                    message: `slot_type must be one of: ${allowedTypes.join(', ')}`
                });
            }
        }

        // Validate is_available if provided
        if (is_available !== undefined) {
            if (typeof is_available !== 'boolean' &&
                is_available !== 'true' &&
                is_available !== 'false') {
                return res.status(400).json({
                    success: false,
                    message: 'is_available must be a boolean'
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

const validateParkingSlotId = (req, res, next) => {
    const { id } = req.params;
    const slotId = parseInt(id);

    if (isNaN(slotId) || slotId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid parking slot ID'
        });
    }

    next();
};

module.exports = {
    validateCreateParkingSlot,
    validateUpdateParkingSlot,
    validateParkingSlotId
};
