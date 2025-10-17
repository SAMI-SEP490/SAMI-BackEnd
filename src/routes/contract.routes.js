// routes/contract.routes.js
// Updated: 2025-17-10
// By: DatNB - Added S3 integration

const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contract.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { upload, handleUploadError } = require('../middlewares/upload.middleware');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo hợp đồng mới (có thể kèm file PDF)
router.post('/',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'), // Field name: contract_file
    handleUploadError,
    contractController.createContract
);

// READ - Lấy danh sách hợp đồng
router.get('/',
    requireRole(['owner', 'manager']),
    contractController.getContracts
);

// READ - Lấy hợp đồng theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    contractController.getContractById
);

// UPDATE - Cập nhật hợp đồng (có thể thay đổi file PDF)
router.put('/:id',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'),
    handleUploadError,
    contractController.updateContract
);

// DELETE - Xóa mềm hợp đồng
router.delete('/:id',
    requireRole(['owner', 'manager']),
    contractController.deleteContract
);

// HARD DELETE - Xóa vĩnh viễn hợp đồng (bao gồm file trên S3)
router.delete('/:id/permanent',
    requireRole(['owner']),
    contractController.hardDeleteContract
);

// RESTORE - Khôi phục hợp đồng đã xóa
router.post('/:id/restore',
    requireRole(['owner', 'manager']),
    contractController.restoreContract
);


// DOWNLOAD - Tải xuống file PDF (presigned URL)
router.get('/:id/download',
    requireRole(['owner', 'manager', 'tenant']),
    contractController.downloadContract
);

// DOWNLOAD DIRECT - Tải xuống file PDF trực tiếp (stream)
router.get('/:id/download/direct',
    requireRole(['owner', 'manager', 'tenant']),
    contractController.downloadContractDirect
);

module.exports = router;