// Updated: 2025-12-30
// Refactored: Removed standalone image upload route

const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contract.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { upload, handleUploadError } = require('../middlewares/upload.middleware');
const {
    validateCreateContract,
    validateUpdateContract,
    validateContractId
} = require('../middlewares/contract.validation');

// --- MIDDLEWARES ---
router.use(authenticate);

// --- CREATE ---
// Tạo hợp đồng (Cho phép PDF hoặc Ảnh - Middleware upload tự handle)
router.post('/',
    requireRole(['owner', 'manager']),
    upload.array('contract_file'), // Chấp nhận PDF hoặc Ảnh
    handleUploadError,
    validateCreateContract,
    contractController.createContract
);

// --- READ ---
router.get('/',
    requireRole(['owner', 'manager', 'tenant']),
    contractController.getContracts
);

router.get('/pending-action',
    requireRole(['tenant']),
    contractController.getPendingActionForTenant
);
router.get(
    '/evidence/download',
    requireRole(['owner', 'manager']), // Chỉ Owner/Manager xem được
    contractController.downloadEvidence
);
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.getContractById
);

// --- UPDATE ---
// Cập nhật (Cho phép PDF hoặc Ảnh)
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateContractId,
    upload.array('contract_file'), // Chấp nhận PDF hoặc Ảnh
    handleUploadError,
    contractController.updateContract
);

// --- APPROVAL FLOW ---
router.post('/:id/approve',
    requireRole(['tenant']),
    validateContractId,
    contractController.approveContract
);

// --- TERMINATION FLOW ---
router.post('/:id/request-termination',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.requestTermination
);

router.post('/:id/respond-termination',
    requireRole(['tenant']),
    validateContractId,
    contractController.respondToTerminationRequest
);

router.post('/:id/complete-transaction',
    requireRole(['owner', 'manager']),
    validateContractId,
    contractController.completePendingTransaction
);

// --- DELETE ---
router.delete('/:id/permanent',
    requireRole(['owner']),
    validateContractId,
    contractController.hardDeleteContract
);

// --- DOWNLOAD ---
router.get('/:id/download',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContract
);

router.get('/:id/download/direct',
    requireRole(['owner', 'manager', 'tenant']),
    validateContractId,
    contractController.downloadContractDirect
);



// [NEW] Route Cưỡng chế hủy (Chỉ OWNER)
router.post(
    '/:id/force-terminate',
    requireRole(['owner']),
    upload.array('evidence', 5), // Cho phép upload tối đa 5 file, key là 'evidence'
    contractController.forceTerminate
);

// --- AI IMPORT ---
// Import vẫn chỉ nhận PDF (theo logic AI service hiện tại)
router.post('/import',
    requireRole(['owner', 'manager']),
    upload.single('contract_file'),
    contractController.processContractWithAI
);

module.exports = router;