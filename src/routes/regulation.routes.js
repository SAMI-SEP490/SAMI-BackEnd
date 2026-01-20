// Updated: 2025-11-22
// By: DatNB

const express = require("express");
const router = express.Router();
const regulationController = require("../controllers/regulation.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");
const {
  validateCreateRegulation,
  validateUpdateRegulation,
  validateRegulationId,
  validateBuildingId,
  validateAddFeedback,
} = require("../middlewares/regulation.validation");

// Tất cả routes đều yêu cầu authentication
router.use(authenticate);

// CREATE - Tạo regulation mới (owner và manager)
router.post(
  "/",
  requireRole(["owner", "manager"]),
  // validateCreateRegulation,
  regulationController.createRegulation,
);

// READ - Lấy danh sách regulations
router.get(
  "/",
  requireRole(["owner", "manager", "tenant"]),
  regulationController.getRegulations,
);

// READ - Lấy thông tin regulation theo ID
router.get(
  "/:id",
  requireRole(["owner", "manager", "tenant"]),
  validateRegulationId,
  regulationController.getRegulationById,
);

// READ - Lấy regulations theo building
router.get(
  "/building/:buildingId",
  requireRole(["owner", "manager", "tenant"]),
  validateBuildingId,
  regulationController.getRegulationsByBuilding,
);

// READ - Lấy tất cả versions của một regulation
router.get(
  "/versions/:title",
  requireRole(["owner", "manager"]),
  regulationController.getRegulationVersions,
);

// READ - Lấy thống kê regulations
router.get(
  "/statistics/:buildingId?",
  requireRole(["owner", "manager"]),
  regulationController.getRegulationStatistics,
);

// READ - Lấy feedbacks của regulation
router.get(
  "/:id/feedbacks",
  requireRole(["owner", "manager", "tenant"]),
  validateRegulationId,
  regulationController.getFeedbacks,
);

// UPDATE - Cập nhật regulation
router.put(
  "/:id",
  requireRole(["owner", "manager"]),
  validateRegulationId,
  validateUpdateRegulation,
  regulationController.updateRegulation,
);

// PUBLISH - Publish regulation
router.post(
  "/:id/publish",
  requireRole(["owner", "manager"]),
  validateRegulationId,
  regulationController.publishRegulation,
);

// UNPUBLISH - Unpublish regulation
router.post(
  "/:id/unpublish",
  requireRole(["owner", "manager"]),
  validateRegulationId,
  regulationController.unpublishRegulation,
);

// CREATE - Thêm feedback cho regulation (tenant có thể feedback)
router.post(
  "/:id/feedbacks",
  requireRole(["tenant"]),
  validateRegulationId,
  validateAddFeedback,
  regulationController.addFeedback,
);

// DELETE - Xóa regulation (soft delete - chuyển status sang 'deleted')
router.delete(
  "/:id",
  requireRole(["owner"]),
  validateRegulationId,
  regulationController.deleteRegulation,
);

module.exports = router;
