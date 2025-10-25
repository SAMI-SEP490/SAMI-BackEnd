// Updated: 2025-24-10
// By: Datnb

const express = require('express');
const router = express.Router();
const contractAddendumController = require('../controllers/addendum.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateAddendum,
    validateUpdateAddendum,
    validateAddendumId
} = require('../middlewares/contract.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo phụ lục hợp đồng mới
router.post('/',
    requireRole(['owner', 'manager']),
    validateCreateAddendum,
    contractAddendumController.createAddendum
);

// READ - Lấy danh sách phụ lục
router.get('/',
    requireRole(['owner', 'manager', 'tenant']),
    contractAddendumController.getAddendums
);

// READ - Lấy thống kê phụ lục
router.get('/statistics',
    requireRole(['owner', 'manager']),
    contractAddendumController.getAddendumStatistics
);

// READ - Lấy phụ lục theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateAddendumId,
    contractAddendumController.getAddendumById
);

// READ - Lấy tất cả phụ lục của một hợp đồng
router.get('/contract/:contract_id',
    requireRole(['owner', 'manager', 'tenant']),
    contractAddendumController.getAddendumsByContract
);

// UPDATE - Cập nhật phụ lục
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateAddendumId,
    validateUpdateAddendum,
    contractAddendumController.updateAddendum
);

// DELETE - Xóa phụ lục
router.delete('/:id',
    requireRole(['owner', 'manager']),
    validateAddendumId,
    contractAddendumController.deleteAddendum
);

module.exports = router;