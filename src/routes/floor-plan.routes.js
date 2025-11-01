// Updated: 2025-01-11
// By: DatNB

const express = require('express');
const router = express.Router();
const floorPlanController = require('../controllers/floor-plan.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const {
    validateCreateFloorPlan,
    validateUpdateFloorPlan,
    validateFloorPlanId,
    validateBuildingId,
    validateFloorNumber
} = require('../middlewares/floor-plan.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo floor plan mới (owner và manager)
router.post('/',
    requireRole(['owner', 'manager']),
    validateCreateFloorPlan,
    floorPlanController.createFloorPlan
);

// READ - Lấy danh sách floor plans
router.get('/',
    requireRole(['owner', 'manager']),
    floorPlanController.getFloorPlans
);

// READ - Lấy thông tin floor plan theo ID
router.get('/:id',
    requireRole(['owner', 'manager', 'tenant']),
    validateFloorPlanId,
    floorPlanController.getFloorPlanById
);

// READ - Lấy floor plans theo building
router.get('/building/:buildingId',
    requireRole(['owner', 'manager', 'tenant']),
    validateBuildingId,
    floorPlanController.getFloorPlansByBuilding
);

// READ - Lấy tất cả versions của một floor
router.get('/building/:buildingId/floor/:floorNumber/versions',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    validateFloorNumber,
    floorPlanController.getFloorPlanVersions
);

// READ - Lấy thống kê floor plans của building
router.get('/building/:buildingId/statistics',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    floorPlanController.getFloorPlanStatistics
);

// UPDATE - Cập nhật floor plan
router.put('/:id',
    requireRole(['owner', 'manager']),
    validateFloorPlanId,
    validateUpdateFloorPlan,
    floorPlanController.updateFloorPlan
);

// PUBLISH - Publish floor plan
router.post('/:id/publish',
    requireRole(['owner', 'manager']),
    validateFloorPlanId,
    floorPlanController.publishFloorPlan
);

// UNPUBLISH - Unpublish floor plan
router.post('/:id/unpublish',
    requireRole(['owner', 'manager']),
    validateFloorPlanId,
    floorPlanController.unpublishFloorPlan
);

// DELETE - Xóa floor plan
router.delete('/:id',
    requireRole(['owner']),
    validateFloorPlanId,
    floorPlanController.deleteFloorPlan
);

module.exports = router;