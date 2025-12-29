const express = require('express');
const router = express.Router();
const parkingSlotController = require('../controllers/parking-slot.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateParkingSlot,
    validateUpdateParkingSlot,
    validateParkingSlotId
} = require('../middlewares/parking-slot.validation');
// All routes require authentication
router.use(authenticate);

// CREATE - Tạo parking slot
router.post('/',
    requireRole(['owner', 'manager']),
    validateCreateParkingSlot,
    parkingSlotController.createParkingSlot
);

// READ - Lấy danh sách parking slot
router.get('/',
    requireRole(['owner', 'manager', 'tenant']),
    parkingSlotController.getParkingSlots
);

// READ - Lấy parking slot theo ID
router.get('/:id',
    requireRole(['owner', 'manager']),
    parkingSlotController.getParkingSlotById
);

// UPDATE - Cập nhật parking slot
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateUpdateParkingSlot,
    parkingSlotController.updateParkingSlot
);

// DELETE - Xóa parking slot
router.delete('/:id',
    requireRole(['owner', 'manager']),
    validateParkingSlotId,
    parkingSlotController.deleteParkingSlot
);
// GET available parking slots
router.get(
    '/available',
    requireRole(['OWNER', 'MANAGER']),
    parkingSlotController.getAvailableParkingSlots
);
module.exports = router;
