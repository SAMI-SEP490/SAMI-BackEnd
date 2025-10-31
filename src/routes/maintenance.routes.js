// Updated: 2025-31-10
// By: DatNB

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateMaintenanceRequestId,
    validateCreateMaintenanceRequest,
    validateUpdateMaintenanceRequest,
    validateRejectMaintenanceRequest,
    validateRoomId
} = require('../middlewares/maintenance.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// STATISTICS - Lấy thống kê tổng quan (đặt trước các route có param)
router.get('/statistics',
    requireRole(['owner', 'manager', 'tenant']),
    maintenanceController.getMaintenanceStatistics
);

// ROOM HISTORY - Lấy lịch sử bảo trì của một phòng
router.get('/room/:roomId/history',
    requireRole(['owner', 'manager']),
    validateRoomId,
    maintenanceController.getRoomMaintenanceHistory
);

// CREATE - Tạo yêu cầu bảo trì mới (chỉ tenant)
router.post('/',
    requireRole(['tenant']),
    validateCreateMaintenanceRequest,
    maintenanceController.createMaintenanceRequest
);

// READ - Lấy danh sách yêu cầu bảo trì
router.get('/',
    requireRole(['owner', 'manager', 'tenant']),
    maintenanceController.getMaintenanceRequests
);

// READ - Lấy yêu cầu bảo trì theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateMaintenanceRequestId,
    maintenanceController.getMaintenanceRequestById
);

// UPDATE - Cập nhật yêu cầu bảo trì
router.put('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateMaintenanceRequestId,
    validateUpdateMaintenanceRequest,
    maintenanceController.updateMaintenanceRequest
);

// DELETE - Xóa yêu cầu bảo trì (tenant chỉ xóa được yêu cầu pending của mình)
router.delete('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateMaintenanceRequestId,
    maintenanceController.deleteMaintenanceRequest
);

// APPROVE - Phê duyệt yêu cầu bảo trì (chỉ owner/manager)
router.post('/:id/approve',
    requireRole(['owner', 'manager']),
    validateMaintenanceRequestId,
    maintenanceController.approveMaintenanceRequest
);

// REJECT - Từ chối yêu cầu bảo trì (chỉ owner/manager)
router.post('/:id/reject',
    requireRole(['owner', 'manager']),
    validateMaintenanceRequestId,
    validateRejectMaintenanceRequest,
    maintenanceController.rejectMaintenanceRequest
);

// RESOLVE - Đánh dấu đã giải quyết (chỉ owner/manager)
router.post('/:id/resolve',
    requireRole(['owner', 'manager']),
    validateMaintenanceRequestId,
    maintenanceController.resolveMaintenanceRequest
);

// COMPLETE - Đánh dấu hoàn thành (chỉ owner/manager)
router.post('/:id/complete',
    requireRole(['owner', 'manager']),
    validateMaintenanceRequestId,
    maintenanceController.completeMaintenanceRequest
);

module.exports = router;