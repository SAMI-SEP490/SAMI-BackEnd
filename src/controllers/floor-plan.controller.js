// Updated: 2025-12-12
// By: DatNB

const floorPlanService = require("../services/floor-plan.service");

class FloorPlanController {
  // Tạo floor plan mới
  async createFloorPlan(req, res, next) {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ OWNER và MANAGER mới có quyền tạo floor plan
      if (userRole !== "OWNER" && userRole !== "MANAGER") {
        return res.status(403).json({
          success: false,
          message:
            "Access denied: You do not have permission to create floor plans",
        });
      }

      const floorPlan = await floorPlanService.createFloorPlan(
        req.body,
        userId,
        userRole
      );

      res.json({
        success: true,
        data: floorPlan,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy floor plan theo ID
  async getFloorPlanById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const floorPlan = await floorPlanService.getFloorPlanById(
        parseInt(id),
        userId,
        userRole
      );

      res.json({
        success: true,
        data: floorPlan,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy danh sách floor plans
  async getFloorPlans(req, res, next) {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const floorPlans = await floorPlanService.getFloorPlans(
        req.query,
        userId,
        userRole
      );

      res.json({
        success: true,
        ...floorPlans,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy tầng tiếp theo cần tạo (dựa trên dữ liệu floor_plans trong DB)
  // GET /floor-plan/buildings/:buildingId/next-floor
  async getNextFloorNumber(req, res) {
    try {
      const buildingId = parseInt(req.params.buildingId, 10);
      const result = await floorPlanService.getNextFloorNumber(buildingId);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("getNextFloorNumber error:", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  // Lấy floor plans theo building
  async getFloorPlansByBuilding(req, res, next) {
    try {
      const { buildingId } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const floorPlans = await floorPlanService.getFloorPlansByBuilding(
        parseInt(buildingId),
        req.query,
        userId,
        userRole
      );

      res.json({
        success: true,
        ...floorPlans,
      });
    } catch (err) {
      next(err);
    }
  }

  // Cập nhật floor plan
  async updateFloorPlan(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ OWNER mới có quyền cập nhật floor plan
      if (userRole !== "OWNER") {
        return res.status(403).json({
          success: false,
          message: "Access denied: Only owners can update floor plans",
        });
      }

      const floorPlan = await floorPlanService.updateFloorPlan(
        parseInt(id),
        req.body,
        userId,
        userRole
      );

      res.json({
        success: true,
        data: floorPlan,
      });
    } catch (err) {
      next(err);
    }
  }

  // Publish floor plan
  async publishFloorPlan(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ OWNER mới có quyền publish floor plan
      if (userRole !== "OWNER") {
        return res.status(403).json({
          success: false,
          message: "Access denied: Only owners can publish floor plans",
        });
      }

      const floorPlan = await floorPlanService.publishFloorPlan(
        parseInt(id),
        userId,
        userRole
      );

      res.json({
        success: true,
        data: floorPlan,
      });
    } catch (err) {
      next(err);
    }
  }

  // Unpublish floor plan
  async unpublishFloorPlan(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ OWNER mới có quyền unpublish floor plan
      if (userRole !== "OWNER") {
        return res.status(403).json({
          success: false,
          message: "Access denied: Only owners can unpublish floor plans",
        });
      }

      const floorPlan = await floorPlanService.unpublishFloorPlan(
        parseInt(id),
        userId,
        userRole
      );

      res.json({
        success: true,
        data: floorPlan,
      });
    } catch (err) {
      next(err);
    }
  }

  // Xóa floor plan
  async deleteFloorPlan(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ OWNER mới có quyền xóa floor plan
      if (userRole !== "OWNER") {
        return res.status(200).json({
          success: true,
          message: "Access denied: Only owners can delete floor plans",
        });
      }

      const result = await floorPlanService.deleteFloorPlan(
        parseInt(id),
        userId,
        userRole
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  // Thống kê floor plans
  async getFloorPlanStatistics(req, res, next) {
    try {
      const { buildingId } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const statistics = await floorPlanService.getFloorPlanStatistics(
        parseInt(buildingId),
        userId,
        userRole
      );

      res.json({
        success: true,
        data: statistics,
      });
    } catch (err) {
      next(err);
    }
  }

  // ✅ NEW: GET next floor number by building_id
  async getNextFloorNumber(req, res) {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const buildingId = parseInt(req.query.building_id);

      const result = await floorPlanService.getNextFloorNumber(
        buildingId,
        userId,
        userRole
      );

      return res.json({
        success: true,
        next_floor_number: result.next_floor_number,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new FloorPlanController();
