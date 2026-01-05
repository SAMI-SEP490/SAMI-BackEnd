// Updated: 2025-11-06
// By: DatNB

const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateRoom,
    validateUpdateRoom,
    validateRoomId,
    validateBuildingId,
    validateUserID
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

// READ - Lấy thống kê phòng theo building (MORE SPECIFIC - before :id)
router.get('/statistics/building/:buildingId',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    roomController.getRoomStatisticsByBuilding
);

router.get('/building/:buildingId',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    roomController.getSimpleBuildingRooms
);

// READ - Lấy thông tin phòng theo userID (MORE SPECIFIC - before :id)
router.get('/user/:userId',
    requireRole(['owner', 'manager', 'tenant']),
    validateUserID,
    roomController.getRoomsByUserId
);

// READ - Lấy thông tin phòng theo ID (GENERIC - after specific routes)
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateRoomId,
    roomController.getRoomById
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
