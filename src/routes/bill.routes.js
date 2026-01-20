// Updated: 2026-01-04
// by: MinhBH

const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { 
    validate, 
    createDraftBillSchema, 
    createIssuedBillSchema, 
    updateDraftBillSchema,
    updateIssuedBillSchema 
} = require('../middlewares/validation.middleware');

// Áp dụng xác thực cho tất cả các routes
router.use(authenticate);

// ==========================================
// 1. ROUTES DÀNH CHO NGƯỜI THUÊ (TENANT)
// ==========================================

// Xem danh sách hóa đơn của chính mình (đã phát hành, đã trả, quá hạn)
router.get(
    '/list', 
    requireRole(['tenant']), 
    billController.getMyBills
);

// Xem danh sách hóa đơn chưa thanh toán (để hiện cảnh báo đỏ)
router.get(
    '/list/unpaid', 
    requireRole(['tenant']), 
    billController.getMyUnpaidBills
);

// ==========================================
// 2. ROUTES DÀNH CHO QUẢN LÝ (MANAGER/OWNER)
// ==========================================
router.use(requireRole(['owner', 'manager']));

// --- XEM DANH SÁCH (LISTING) ---

// Xem tất cả hóa đơn trong hệ thống (có thể lọc theo ?status=... hoặc ?room_id=...)
router.get('/all', billController.getAllBills);

// Xem các hóa đơn đang ở trạng thái Nháp (Draft)
router.get('/draft', billController.getDraftBills);

// Xem các hóa đơn đã bị xóa mềm (Soft Deleted)
router.get('/deleted', billController.getDeletedBills);

// Xem chi tiết một hóa đơn cụ thể (bao gồm các khoản phí dịch vụ, lịch sử trả tiền)
router.get('/detail/:id', billController.getBillById);

// Lấy danh sách các phòng CHƯA có hóa đơn trong tháng này (để tránh tạo trùng)
// Query: ?period_start=2026-01-01
router.get('/unbilled-rooms', billController.getUnbilledRooms);

// Calculate penalty before extending (Frontend calls this to show preview)
router.get('/penalty-calc/:id', billController.getPenaltyCalculation);

// --- TẠO MỚI (CREATE) ---

// Tạo hóa đơn Nháp (Chưa gửi cho khách, có thể sửa thoải mái)
router.post('/create/draft', validate(createDraftBillSchema), billController.createDraftBill);

// POST /api/bills/bulk
// Body: { building_id: 1, bill_type: 'utilities', month: 2, year: 2026, due_date: '...' }
router.post('/create/bulk', billController.createBulkBill);

// Sửa hóa đơn Nháp (Có thể sửa tiền, dịch vụ, hoặc chuyển trạng thái sang 'issued' để phát hành)
router.put('/edit/draft/:id', validate(updateDraftBillSchema), billController.updateDraftBill);

// --- GIA HẠN (EXTENSION) - [NEW] ---

// Gia hạn cho hóa đơn Quá hạn (Overdue)
// Logic: Cộng thêm 5 ngày vào Due Date, chuyển trạng thái về 'Issued' để khách đóng tiền
// Body: { "penalty_amount": 50000 } (Tùy chọn phạt thêm)
router.post('/extend/:id', billController.extendBill);

// --- XÓA / KHÔI PHỤC (DELETE/RESTORE) ---

// Xóa mềm (nếu là Draft) hoặc Hủy bỏ (nếu là Issued/Overdue)
router.delete('/delete/:id', billController.deleteOrCancelBill);

// Khôi phục hóa đơn đã bị xóa mềm
router.post('/restore/:id', billController.restoreBill);

// --- HỆ THỐNG (SYSTEM) ---

// Chạy thủ công tool quét tự động (Thay vì chờ đến nửa đêm)
// 1. Quét các bill quá hạn -> Chuyển thành Overdue
// 2. Tự động tạo bill cho tháng tới (nếu đến ngày)
router.post('/refresh-status', billController.refreshBillStatuses);

// Chạy thủ công tool nhắc nhở
router.post('/trigger-reminders',
    requireRole(['owner', 'manager']),
    billController.triggerReminders
);

module.exports = router;
