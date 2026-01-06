// Updated: 2025-01-06
// By: DatNB
// Refactored: Added file upload support + Tenant approval routes

const express = require('express');
const router = express.Router();
const contractAddendumController = require('../controllers/addendum.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { upload, handleUploadError } = require('../middlewares/upload.middleware');
const {
    validateCreateAddendum,
    validateUpdateAddendum,
    validateAddendumId
} = require('../middlewares/contract.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo phụ lục hợp đồng mới (với file upload)
router.post('/',
    requireRole(['owner', 'manager']),
    upload.array('addendum_file'), // Hỗ trợ PDF hoặc Images
    handleUploadError,
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

// APPROVE - Tenant duyệt phụ lục (Apply changes to contract)
router.post('/:id/approve',
    requireRole(['tenant']), // Chỉ tenant mới được approve
    validateAddendumId,
    contractAddendumController.approveAddendum
);

// REJECT - Tenant từ chối phụ lục
router.post('/:id/reject',
    requireRole(['tenant']), // Chỉ tenant mới được reject
    validateAddendumId,
    contractAddendumController.rejectAddendum
);

// UPDATE - Cập nhật phụ lục (only for pending_approval status, có thể thay file)
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateAddendumId,
    upload.array('addendum_file'), // Hỗ trợ thay đổi file
    handleUploadError,
    validateUpdateAddendum,
    contractAddendumController.updateAddendum
);

// DELETE - Xóa phụ lục (chỉ owner và chỉ khi pending hoặc rejected)
router.delete('/:id',
    requireRole(['owner']), // Chỉ owner mới được xóa
    validateAddendumId,
    contractAddendumController.deleteAddendum
);

// DOWNLOAD - Lấy presigned URL để download
router.get('/:id/download',
    requireRole(['owner', 'manager', 'tenant']),
    validateAddendumId,
    contractAddendumController.downloadAddendum
);

// DOWNLOAD - Stream trực tiếp file
router.get('/:id/download/direct',
    requireRole(['owner', 'manager', 'tenant']),
    validateAddendumId,
    contractAddendumController.downloadAddendumDirect
);

module.exports = router;