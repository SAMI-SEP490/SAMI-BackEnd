// Updated: 2025-24-10
// by: DatNB

const validateCreateContract = (req, res, next) => {
    const {
        room_id,
        tenant_user_id,
        start_date,
        duration_months, // Logic mới cần trường này
        rent_amount
    } = req.body;


    if (!room_id || !tenant_user_id || !start_date || !duration_months || !rent_amount) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: room_id, tenant_user_id, start_date, duration_months, rent_amount'
        });
    }

    // Validate kiểu dữ liệu cơ bản (nếu cần)
    if (isNaN(parseInt(duration_months)) || parseInt(duration_months) < 1) {
        return res.status(400).json({
            success: false,
            message: 'Duration months must be a valid number >= 1'
        });
    }

    next();
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
const validateCreateAddendum = (req, res, next) => {
    try {
        const { contract_id, type, summary, changes, effective_date, note } = req.body;

        // Required fields
        if (!contract_id || !type || !summary || !effective_date) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: contract_id, type, summary, effective_date'
            });
        }

        // Parse and validate contract_id
        const parsedContractId = parseInt(contract_id);
        if (isNaN(parsedContractId) || parsedContractId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'contract_id must be a valid positive number'
            });
        }

        // Validate type
        const validTypes = ['extension', 'rent_change', 'early_termination', 'general', 'other'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                message: `type must be one of: ${validTypes.join(', ')}`
            });
        }

        // Validate summary
        if (typeof summary !== 'string' || summary.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'summary must be a non-empty string'
            });
        }

        if (summary.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'summary must not exceed 500 characters'
            });
        }

        // Validate changes if provided
        if (changes !== undefined && changes !== null) {
            try {
                if (typeof changes === 'string') {
                    JSON.parse(changes);
                } else if (typeof changes !== 'object') {
                    throw new Error('Invalid changes type');
                }
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'changes must be valid JSON'
                });
            }
        }

        // Validate effective_date
        const effectiveDate = new Date(effective_date);
        if (isNaN(effectiveDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'effective_date is not a valid date'
            });
        }

        // Validate note if provided
        if (note !== undefined && note !== null) {
            if (typeof note !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'note must be a string'
                });
            }

            if (note.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'note must not exceed 1000 characters'
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

const validateUpdateAddendum = (req, res, next) => {
    try {
        const { type, summary, changes, effective_date, note } = req.body;

        // Check if at least one field is provided
        if (!type && !summary && changes === undefined && !effective_date && note === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field must be provided for update'
            });
        }

        // Validate type if provided
        if (type) {
            const validTypes = ['extension', 'rent_change', 'early_termination', 'general', 'other'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: `type must be one of: ${validTypes.join(', ')}`
                });
            }
        }

        // Validate summary if provided
        if (summary !== undefined) {
            if (typeof summary !== 'string' || summary.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'summary must be a non-empty string'
                });
            }

            if (summary.length > 500) {
                return res.status(400).json({
                    success: false,
                    message: 'summary must not exceed 500 characters'
                });
            }
        }

        // Validate changes if provided
        if (changes !== undefined && changes !== null) {
            try {
                if (typeof changes === 'string') {
                    JSON.parse(changes);
                } else if (typeof changes !== 'object') {
                    throw new Error('Invalid changes type');
                }
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'changes must be valid JSON'
                });
            }
        }

        // Validate effective_date if provided
        if (effective_date) {
            const effectiveDate = new Date(effective_date);
            if (isNaN(effectiveDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'effective_date is not a valid date'
                });
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

            if (note.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'note must not exceed 1000 characters'
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

const validateAddendumId = (req, res, next) => {
    const { id } = req.params;
    const addendumId = parseInt(id);

    if (isNaN(addendumId) || addendumId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid addendum ID'
        });
    }

    next();
};


module.exports = {
    validateCreateContract,
    validateUpdateContract,
    validateContractId,
    validateCreateAddendum,
    validateUpdateAddendum,
    validateAddendumId
};