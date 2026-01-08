// Updated: 2025-01-08
// by: DatNB
// Refactored: Updated Addendum Validation to match Frontend & Service

const validateCreateContract = (req, res, next) => {
    const {
        room_id,
        tenant_user_id,
        start_date,
        duration_months,
        rent_amount
    } = req.body;

    if (!room_id || !tenant_user_id || !start_date || !duration_months || !rent_amount) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: room_id, tenant_user_id, start_date, duration_months, rent_amount'
        });
    }

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

        if (start_date || end_date) {
            if (start_date) {
                const startDate = new Date(start_date);
                if (isNaN(startDate.getTime())) {
                    return res.status(400).json({ success: false, message: 'start_date is not a valid date' });
                }
            }
            if (end_date) {
                const endDate = new Date(end_date);
                if (isNaN(endDate.getTime())) {
                    return res.status(400).json({ success: false, message: 'end_date is not a valid date' });
                }
            }
            if (start_date && end_date) {
                const startDate = new Date(start_date);
                const endDate = new Date(end_date);
                if (startDate >= endDate) {
                    return res.status(400).json({ success: false, message: 'start_date must be before end_date' });
                }
            }
        }

        if (rent_amount !== undefined && rent_amount !== null && rent_amount !== '') {
            const parsedRentAmount = parseFloat(rent_amount);
            if (isNaN(parsedRentAmount) || parsedRentAmount < 0) {
                return res.status(400).json({ success: false, message: 'rent_amount must be a valid positive number' });
            }
        }

        if (deposit_amount !== undefined && deposit_amount !== null && deposit_amount !== '') {
            const parsedDepositAmount = parseFloat(deposit_amount);
            if (isNaN(parsedDepositAmount) || parsedDepositAmount < 0) {
                return res.status(400).json({ success: false, message: 'deposit_amount must be a valid positive number' });
            }
        }

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
        return res.status(400).json({ success: false, message: 'Validation error: ' + error.message });
    }
};

const validateContractId = (req, res, next) => {
    const { id } = req.params;
    const contractId = parseInt(id);

    if (isNaN(contractId) || contractId <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid contract ID' });
    }
    next();
};

// --- PHẦN SỬA ĐỔI CHÍNH ---

const validateCreateAddendum = (req, res, next) => {
    try {
        // Lấy đúng tên trường Frontend gửi lên
        const { contract_id, addendum_type, changes, effective_from, effective_to, note } = req.body;

        // 1. Required fields check
        // Lưu ý: 'note' có thể optional tùy logic, nhưng 'contract_id' và 'addendum_type' là bắt buộc.
        // 'changes' thường bắt buộc trừ khi là termination (tùy logic service).
        if (!contract_id || !addendum_type) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: contract_id, addendum_type'
            });
        }

        // 2. Validate contract_id
        const parsedContractId = parseInt(contract_id);
        if (isNaN(parsedContractId) || parsedContractId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'contract_id must be a valid positive number'
            });
        }

        // 3. Validate addendum_type (Cập nhật danh sách đúng với Frontend)
        const validTypes = [
            'extension',
            'rent_adjustment',
            'deposit_adjustment',
            'payment_terms_change',
            'early_termination',
            'general_amendment'
        ];

        if (!validTypes.includes(addendum_type)) {
            return res.status(400).json({
                success: false,
                message: `addendum_type must be one of: ${validTypes.join(', ')}`
            });
        }

        // 4. Validate changes (JSON String hoặc Object)
        if (changes) {
            try {
                if (typeof changes === 'string') {
                    // Thử parse JSON nếu gửi dạng string (FormData)
                    JSON.parse(changes);
                } else if (typeof changes !== 'object') {
                    throw new Error('Invalid changes type');
                }
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'changes must be a valid JSON object or stringified JSON'
                });
            }
        } else if (addendum_type !== 'early_termination') {
            // Nếu không phải terminate mà thiếu changes thì cảnh báo (tùy logic business)
            // return res.status(400).json({ success: false, message: 'changes is required' });
        }

        // 5. Validate dates
        if (effective_from) {
            const effectiveDate = new Date(effective_from);
            if (isNaN(effectiveDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'effective_from must be a valid date'
                });
            }
        }

        if (effective_to) {
            const effectiveToDate = new Date(effective_to);
            if (isNaN(effectiveToDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'effective_to must be a valid date'
                });
            }
            if (effective_from) {
                const start = new Date(effective_from);
                if (start > effectiveToDate) {
                    return res.status(400).json({
                        success: false,
                        message: 'effective_from must be before effective_to'
                    });
                }
            }
        }

        // 6. Validate note
        if (note && typeof note === 'string') {
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
        // Cập nhật tên trường
        const { addendum_type, changes, effective_from, effective_to, note } = req.body;

        // Check if at least one field is provided
        if (!addendum_type && changes === undefined && !effective_from && !effective_to && note === undefined) {
            // Lưu ý: file upload được check ở middleware upload trước đó hoặc controller
            // Nếu req.files có file thì vẫn hợp lệ, nhưng ở đây chỉ check body
            // Nếu cần chặt chẽ: if (Object.keys(req.body).length === 0 && (!req.files || req.files.length === 0)) ...
        }

        // Validate type
        if (addendum_type) {
            const validTypes = [
                'extension',
                'rent_adjustment',
                'deposit_adjustment',
                'payment_terms_change',
                'early_termination',
                'general_amendment'
            ];
            if (!validTypes.includes(addendum_type)) {
                return res.status(400).json({
                    success: false,
                    message: `addendum_type must be one of: ${validTypes.join(', ')}`
                });
            }
        }

        // Validate changes
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

        // Validate dates
        if (effective_from) {
            const d = new Date(effective_from);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ success: false, message: 'effective_from must be a valid date' });
            }
        }
        if (effective_to) {
            const d = new Date(effective_to);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ success: false, message: 'effective_to must be a valid date' });
            }
        }

        // Validate note
        if (note !== undefined && note !== null) {
            if (typeof note !== 'string') {
                return res.status(400).json({ success: false, message: 'note must be a string' });
            }
            if (note.length > 1000) {
                return res.status(400).json({ success: false, message: 'note must not exceed 1000 characters' });
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