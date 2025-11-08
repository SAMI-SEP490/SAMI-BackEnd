
// Updated: 2025-18-10
// By: DatNB

const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contract.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { upload,uploadImage , handleUploadError} = require('../middlewares/upload.middleware');
const {
    validateCreateContract,
    validateUpdateContract,
    validateContractId
} = require('../middlewares/contract.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo hợp đồng mới (có thể kèm file PDF)
router.post('/',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'), // Field name: contract_file
    handleUploadError,
    validateCreateContract,
    contractController.createContract
);

// READ - Lấy danh sách hợp đồng
router.get('/',
    requireRole(['owner', 'manager','tenant']),
    contractController.getContracts
);

// READ - Lấy hợp đồng theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.getContractById
);

// UPDATE - Cập nhật hợp đồng (có thể thay đổi file PDF)
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateContractId,
    upload.single('contract_file'),
    handleUploadError,
    validateUpdateContract,
    contractController.updateContract
);

// DELETE - Xóa mềm hợp đồng
router.delete('/:id',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.deleteContract
);

// HARD DELETE - Xóa vĩnh viễn hợp đồng (bao gồm file trên S3)
router.delete('/:id/permanent',
    requireRole(['owner']),
    validateContractId,
    contractController.hardDeleteContract
);

// RESTORE - Khôi phục hợp đồng đã xóa
router.post('/:id/restore',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.restoreContract
);

// DOWNLOAD - Tải xuống file PDF (presigned URL)
router.get('/:id/download',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContract
);

// DOWNLOAD DIRECT - Tải xuống file PDF trực tiếp (stream)
router.get('/:id/download/direct',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContractDirect
);
// Upload ảnh → PDF → S3
router.post('/:id/upload-images',
    requireRole(['owner', 'manager']),
    uploadImage.array('images', 10),
    contractController.uploadContractImages);

module.exports = router;