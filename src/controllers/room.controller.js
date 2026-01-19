// Updated: 2025-12-12
// By: DatNB
// Added: Pass user role and id to service for RBAC

const roomService = require("../services/room.service");

class RoomController {
  // Tạo phòng mới
  async createRoom(req, res, next) {
    try {
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const room = await roomService.createRoom(req.body, role, userId);

      res.status(201).json({
        success: true,
        message: "Room created successfully",
        data: room,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy thông tin phòng theo ID
  async getRoomById(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id;
      const room = await roomService.getRoomById(parseInt(id), role, userId);

      res.json({
        success: true,
        data: room,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy danh sách phòng
  async getRooms(req, res, next) {
    try {
      const role = req.user.role;
      const userId = req.user.user_id;

      if (!userId && role === "MANAGER") {
        throw new Error("User ID is missing for Manager role");
      }

      const rooms = await roomService.getRooms(req.query, role, userId);

      res.json({
        success: true,
        data: rooms.data,
        pagination: rooms.pagination,
      });
    } catch (err) {
      next(err);
    }
  }

  async getRoomsByUserId(req, res, next) {
    try {
      const role = req.user.role;
      const userId = req.user.user_id;

      // Extract user ID with proper fallbacks based on your auth middleware
      const authenticatedUserId =
        req.user.userId || req.user.user_id || req.user.id;

      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          message: "User ID is missing from authentication context",
        });
      }

      const rooms = await roomService.getRoomsByUserId(
        parseInt(userId),
        role,
        authenticatedUserId
      );

      res.json({
        success: true,
        data: rooms,
      });
    } catch (err) {
      next(err);
    }
  }

  // Cập nhật phòng
  async updateRoom(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const room = await roomService.updateRoom(
        parseInt(id),
        req.body,
        role,
        userId
      );

      res.json({
        success: true,
        message: "Room updated successfully",
        data: room,
      });
    } catch (err) {
      next(err);
    }
  }

  // Vô hiệu hóa phòng
  async deactivateRoom(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const result = await roomService.deactivateRoom(
        parseInt(id),
        role,
        userId
      );

      res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  // Kích hoạt lại phòng
  async activateRoom(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const room = await roomService.activateRoom(parseInt(id), role, userId);

      res.json({
        success: true,
        message: "Room activated successfully",
        data: room,
      });
    } catch (err) {
      next(err);
    }
  }

  // Xóa vĩnh viễn phòng
  async hardDeleteRoom(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const result = await roomService.hardDeleteRoom(
        parseInt(id),
        role,
        userId
      );

      res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  // Lấy thống kê phòng theo building
  async getRoomStatisticsByBuilding(req, res, next) {
    try {
      const { buildingId } = req.params;
      const role = req.user.role;
      const userId = req.user.user_id; // Lấy từ middleware auth
      const statistics = await roomService.getRoomStatisticsByBuilding(
        parseInt(buildingId),
        role,
        userId
      );

      res.json({
        success: true,
        data: statistics,
      });
    } catch (err) {
      next(err);
    }
  }
  // [NEW] API đơn giản để lấy phòng theo Building, hỗ trợ lọc phòng trống
  async getSimpleBuildingRooms(req, res, next) {
    try {
      const { buildingId } = req.params;
      const { onlyEmpty } = req.query; // ?onlyEmpty=true để lấy phòng chưa có HĐ

      // Gọi service mới
      const rooms = await roomService.getSimpleRoomsByBuilding(
        buildingId,
        onlyEmpty
      );

      res.json({
        success: true,
        data: rooms,
      });
    } catch (err) {
      next(err);
    }
  }
  // [NEW] Thêm tenant vào phòng
  async addTenantToRoom(req, res, next) {
    try {
      const roomId = Number(req.params.id);
      const { user_id, moved_in_at, note } = req.body;

      // ✅ Validate roomId
      if (!roomId || isNaN(roomId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid room id",
        });
      }

      // ✅ Validate user_id
      const tenantUserId = Number(user_id);
      if (!tenantUserId || isNaN(tenantUserId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user_id",
        });
      }

      // ✅ Validate moved_in_at
      if (!moved_in_at || isNaN(new Date(moved_in_at).getTime())) {
        return res.status(400).json({
          success: false,
          message: "moved_in_at is required and must be a valid date",
        });
      }

      const role = (req.user.role || "").toUpperCase();
      const operatorId = req.user.user_id;

      const result = await roomService.addTenantToRoom(
        roomId,
        tenantUserId,
        role,
        operatorId,
        {
          moved_in_at,
          note,
        }
      );

      res.status(201).json({
        success: true,
        message: "Tenant added to room successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  // [NEW] Xóa tenant ở phụ khỏi phòng
async removeSecondaryTenantFromRoom(req, res, next) {
  try {
    const roomId = Number(req.params.id);
    const tenantUserId = Number(req.params.tenantUserId);

    if (!roomId || isNaN(roomId)) {
      return res.status(400).json({ success: false, message: "Invalid room id" });
    }
    if (!tenantUserId || isNaN(tenantUserId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tenant user id" });
    }

    const role = req.user.role;
    const userId = req.user.user_id;

    const result = await roomService.removeSecondaryTenantFromRoom(
      roomId,
      tenantUserId,
      role,
      userId
    );

    return res.json({
      success: true,
      message: "Removed secondary tenant successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

}

module.exports = new RoomController();
