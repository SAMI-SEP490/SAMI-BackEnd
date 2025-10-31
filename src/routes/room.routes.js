// Updated: 2025-10-31
// By: DatNB

const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateRoom,
    validateUpdateRoom,
    validateRoomId,
    validateBuildingId
} = require('../middlewares/room.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo phòng mới (owner, manager)
router.post('/',
    requireRole(['owner', 'manager']),
    validateCreateRoom,
    roomController.createRoom
);

// READ - Lấy danh sách phòng
router.get('/',
    requireRole(['owner', 'manager']),
    roomController.getRooms
);

// READ - Lấy thông tin phòng theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateRoomId,
    roomController.getRoomById
);

// READ - Lấy thống kê phòng theo building
router.get('/statistics/building/:buildingId',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    roomController.getRoomStatisticsByBuilding
);

// UPDATE - Cập nhật phòng
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateRoomId,
    validateUpdateRoom,
    roomController.updateRoom
);

// DEACTIVATE - Vô hiệu hóa phòng
router.post('/:id/deactivate',
    requireRole(['owner', 'manager']),
    validateRoomId,
    roomController.deactivateRoom
);

// ACTIVATE - Kích hoạt lại phòng
router.post('/:id/activate',
    requireRole(['owner', 'manager']),
    validateRoomId,
    roomController.activateRoom
);

// DELETE - Xóa vĩnh viễn phòng
router.delete('/:id/permanent',
    requireRole(['owner']),
    validateRoomId,
    roomController.hardDeleteRoom
);

module.exports = router;