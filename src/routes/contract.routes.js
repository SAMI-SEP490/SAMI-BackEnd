// Updated: 2025-12-29
// By: DatNB & Gemini Refactor

const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contract.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { upload, uploadImage, handleUploadError } = require('../middlewares/upload.middleware');
const {
    validateCreateContract,
    validateUpdateContract,
    validateContractId
} = require('../middlewares/contract.validation');

// --- MIDDLEWARES ---
router.use(authenticate);

// --- CREATE ---
// Tạo hợp đồng (Manager/Owner)
router.post('/',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'),
    handleUploadError,
    validateCreateContract,
    contractController.createContract
);

// --- READ ---
// Lấy danh sách hợp đồng
router.get('/',
    requireRole(['owner', 'manager', 'tenant']),
    contractController.getContracts
);

// Lấy chi tiết hợp đồng
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.getContractById
);

// --- UPDATE & PROCESS ---
// Cập nhật thông tin/file hợp đồng (Chỉ sửa được khi Pending/Rejected)
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateContractId,
    upload.single('contract_file'),
    handleUploadError,
    validateUpdateContract,
    contractController.updateContract
);

// --- APPROVAL FLOW (Tenant) ---
// Tenant chấp nhận hoặc từ chối hợp đồng
router.post('/:id/approve',
    requireRole(['tenant']),
    validateContractId,
    contractController.approveContract
);

// --- TERMINATION FLOW ---
// 1. Manager yêu cầu chấm dứt hợp đồng
router.post('/:id/request-termination',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.requestTermination
);

// 2. Tenant phản hồi yêu cầu chấm dứt (Đồng ý/Từ chối)
router.post('/:id/respond-termination',
    requireRole(['tenant']),
    validateContractId,
    contractController.respondToTerminationRequest
);

// 3. Manager chốt giao dịch sau khi thanh toán hóa đơn
router.post('/:id/complete-transaction',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.completePendingTransaction
);

// --- DELETE ---
// Xóa vĩnh viễn (Chỉ Owner - Dành cho HĐ đã kết thúc/hết hạn)
router.delete('/:id/permanent',
    requireRole(['owner']),
    validateContractId,
    contractController.hardDeleteContract
);

// --- DOWNLOAD ---
// Lấy URL tải xuống
router.get('/:id/download',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContract
);

// Tải file trực tiếp
router.get('/:id/download/direct',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContractDirect
);

// --- UTILITIES ---
// Upload ảnh để convert sang PDF
router.post('/:id/upload-images',
    requireRole(['owner', 'manager']),
    uploadImage.array('images', 10),
    contractController.uploadContractImages
);

// Import hợp đồng bằng AI
router.post('/import',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'),
    contractController.processContractWithAI
);


module.exports = router;