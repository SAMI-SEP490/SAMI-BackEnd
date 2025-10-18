// Updated: 2025-18-10
// by: DatNB

const validateCreateContract = (req, res, next) => {
    try {
        const { room_id, tenant_user_id, start_date, end_date, rent_amount, deposit_amount } = req.body;

        // Required fields
        if (!room_id || !tenant_user_id || !start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: room_id, tenant_user_id, start_date, end_date'
            });
        }

        // Parse and validate integers
        const parsedRoomId = parseInt(room_id);
        const parsedTenantUserId = parseInt(tenant_user_id);

        if (isNaN(parsedRoomId)) {
            return res.status(400).json({
                success: false,
                message: 'room_id must be a valid number'
            });
        }

        if (isNaN(parsedTenantUserId)) {
            return res.status(400).json({
                success: false,
                message: 'tenant_user_id must be a valid number'
            });
        }

        // Validate positive numbers
        if (parsedRoomId <= 0 || parsedTenantUserId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'room_id and tenant_user_id must be positive numbers'
            });
        }

        // Validate dates
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (isNaN(startDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'start_date is not a valid date'
            });
        }

        if (isNaN(endDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'end_date is not a valid date'
            });
        }

        if (startDate >= endDate) {
            return res.status(400).json({
                success: false,
                message: 'start_date must be before end_date'
            });
        }

        // Validate amounts if provided
        if (rent_amount !== undefined && rent_amount !== null && rent_amount !== '') {
            const parsedRentAmount = parseFloat(rent_amount);
            if (isNaN(parsedRentAmount) || parsedRentAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'rent_amount must be a valid positive number'
                });
            }
        }

        if (deposit_amount !== undefined && deposit_amount !== null && deposit_amount !== '') {
            const parsedDepositAmount = parseFloat(deposit_amount);
            if (isNaN(parsedDepositAmount) || parsedDepositAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'deposit_amount must be a valid positive number'
                });
            }
        }

        // Validate status if provided
        if (req.body.status) {
            const validStatuses = ['pending', 'active', 'terminated', 'expired'];
            if (!validStatuses.includes(req.body.status)) {
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

const validateUpdateContract = (req, res, next) => {
    try {
        const { start_date, end_date, rent_amount, deposit_amount, status } = req.body;

        // Validate dates if provided
        if (start_date || end_date) {
            if (start_date) {
                const startDate = new Date(start_date);
                if (isNaN(startDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'start_date is not a valid date'
                    });
                }
            }

            if (end_date) {
                const endDate = new Date(end_date);
                if (isNaN(endDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'end_date is not a valid date'
                    });
                }
            }

            if (start_date && end_date) {
                const startDate = new Date(start_date);
                const endDate = new Date(end_date);
                if (startDate >= endDate) {
                    return res.status(400).json({
                        success: false,
                        message: 'start_date must be before end_date'
                    });
                }
            }
        }

        // Validate amounts if provided
        if (rent_amount !== undefined && rent_amount !== null && rent_amount !== '') {
            const parsedRentAmount = parseFloat(rent_amount);
            if (isNaN(parsedRentAmount) || parsedRentAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'rent_amount must be a valid positive number'
                });
            }
        }

        if (deposit_amount !== undefined && deposit_amount !== null && deposit_amount !== '') {
            const parsedDepositAmount = parseFloat(deposit_amount);
            if (isNaN(parsedDepositAmount) || parsedDepositAmount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'deposit_amount must be a valid positive number'
                });
            }
        }

        // Validate status if provided
        if (status) {
            const validStatuses = ['pending', 'active', 'terminated', 'expired'];
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

const validateContractId = (req, res, next) => {
    const { id } = req.params;
    const contractId = parseInt(id);

    if (isNaN(contractId) || contractId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid contract ID'
        });
    }

    next();
};

module.exports = {
    validateCreateContract,
    validateUpdateContract,
    validateContractId
};