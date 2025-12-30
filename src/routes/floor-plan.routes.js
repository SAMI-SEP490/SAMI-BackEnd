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
    validateFloorNumber,
    validateBuildingIdQuery,
} = require('../middlewares/floor-plan.validation');

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo floor plan mới
router.post('/',
    requireRole(['owner', 'manager']),
    validateCreateFloorPlan,
    floorPlanController.createFloorPlan
);

// GET - Lấy danh sách floor plans (có thể filter)
router.get('/',
    requireRole(['owner', 'manager']),
    floorPlanController.getFloorPlans
);

// NEXT FLOOR - Lấy tầng tiếp theo cần tạo cho một tòa nhà (dựa trên floor_plans)
router.get('/next-floor',
    requireRole(['owner', 'manager']),
    floorPlanController.getNextFloorNumber
);

// GET - Lấy floor plan theo ID
router.get('/:id',
    requireRole(['owner', 'manager']),
    validateFloorPlanId,
    floorPlanController.getFloorPlanById
);

// GET - Lấy floor plans theo building
router.get('/building/:buildingId',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    floorPlanController.getFloorPlansByBuilding
);

// GET - Thống kê floor plans theo building
router.get('/building/:buildingId/statistics',
    requireRole(['owner', 'manager']),
    validateBuildingId,
    floorPlanController.getFloorPlanStatistics
);

// UPDATE - Cập nhật floor plan
router.put('/:id',
    requireRole(['owner']),
    validateFloorPlanId,
    validateUpdateFloorPlan,
    floorPlanController.updateFloorPlan
);

// PUBLISH - Publish floor plan
router.post('/:id/publish',
    requireRole(['owner']),
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

// ✅ NEW route: lấy tầng kế tiếp theo DB
router.get(
  '/next-floor',
  requireRole(['owner', 'manager']),
  validateBuildingIdQuery,
  floorPlanController.getNextFloorNumber
);


module.exports = router;
