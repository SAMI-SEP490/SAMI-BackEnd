
// Updated: 2025-17-10
// by: DatNB

const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contract.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validate,
    createContractSchema,
    updateContractSchema
} = require('../middlewares/validation.middleware');

// All routes require authentication
router.use(authenticate);

// CREATE - Tạo hợp đồng mới
// Chỉ MANAGER và OWNER có thể tạo
router.post(
    '/',
    requireRole(['manager', 'owner']),
    validate(createContractSchema),
    contractController.create
);

// READ - Lấy tất cả hợp đồng
// TENANT chỉ xem hợp đồng của mình
router.get('/', requireRole(['manager', 'owner']), contractController.getAll);

// READ - Lấy hợp đồng theo ID
router.get('/:contractId', contractController.getById);

// UPDATE - Cập nhật hợp đồng
// Chỉ MANAGER và OWNER có thể cập nhật
router.put(
    '/:contractId',
    requireRole(['manager', 'owner']),
    validate(updateContractSchema),
    contractController.update
);

// DELETE - Xóa mềm hợp đồng
// Chỉ OWNER có thể xóa
router.delete(
    '/:contractId',
    requireRole(['owner']),
    contractController.delete
);

// RESTORE - Khôi phục hợp đồng đã xóa
// Chỉ OWNER có thể khôi phục
router.post(
    '/:contractId/restore',
    requireRole(['owner']),
    contractController.restore
);

// TERMINATE - Kết thúc hợp đồng
// Chỉ MANAGER và OWNER có thể kết thúc
router.post(
    '/:contractId/terminate',
    requireRole(['manager', 'owner']),
    contractController.terminate
);

module.exports = router;