// Updated: 2025-31-10
// By: DatNB

const express = require('express');
const router = express.Router();
const buildingController = require('../controllers/building.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateBuilding,
    validateUpdateBuilding,
    validateBuildingId,
    validateAssignManager,
    validateUpdateManagerAssignment,
    validateUserId
} = require('../middlewares/building.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo tòa nhà mới (chỉ owner)
router.post('/',
    requireRole(['owner']),
    validateCreateBuilding,
    buildingController.createBuilding
);

// READ - Lấy danh sách tòa nhà
router.get('/',
    requireRole(['owner', 'manager']),
    buildingController.getBuildings
);

// READ - Lấy thông tin tòa nhà theo ID
router.get('/:id',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    buildingController.getBuildingById
);

// READ - Lấy thống kê tòa nhà
router.get('/:id/statistics',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    buildingController.getBuildingStatistics
);

// READ - Lấy danh sách building managers
router.get('/:id/managers',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    buildingController.getBuildingManagers
);

// CREATE - Gán manager cho tòa nhà
router.post('/:id/managers',
    requireRole(['owner']),
    validateBuildingId,
    validateAssignManager,
    buildingController.assignManager
);

// UPDATE - Cập nhật thông tin assignment của manager
router.put('/:id/managers/:userId',
    requireRole(['owner']),
    validateBuildingId,
    validateUserId,
    validateUpdateManagerAssignment,
    buildingController.updateManagerAssignment
);

// DELETE - Xóa manager khỏi tòa nhà
router.delete('/:id/managers/:userId',
    requireRole(['owner']),
    validateBuildingId,
    validateUserId,
    buildingController.removeManager
);

// UPDATE - Cập nhật tòa nhà
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    validateUpdateBuilding,
    buildingController.updateBuilding
);

// DEACTIVATE - Vô hiệu hóa tòa nhà
router.post('/:id/deactivate',
    requireRole(['owner']),
    validateBuildingId,
    buildingController.deactivateBuilding
);

// ACTIVATE - Kích hoạt lại tòa nhà
router.post('/:id/activate',
    requireRole(['owner']),
    validateBuildingId,
    buildingController.activateBuilding
);

// DELETE - Xóa vĩnh viễn tòa nhà
router.delete('/:id/permanent',
    requireRole(['owner']),
    validateBuildingId,
    buildingController.hardDeleteBuilding
);

module.exports = router;