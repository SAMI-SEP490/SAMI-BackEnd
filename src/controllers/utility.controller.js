// src/controllers/utility.controller.js
// Updated: 2026-01-01

const UtilityService = require("../services/utility.service");

class UtilityController {
  /**
   * GET /api/utility/readings
   * Lấy danh sách phòng + chỉ số THÁNG TRƯỚC
   * Dùng cho màn hình "Nhập chỉ số điện nước"
   */
  async getReadingsForm(req, res, next) {
    try {
      const { building_id, month, year } = req.query;

      if (!building_id || !month || !year) {
        return res.status(400).json({
          success: false,
          message: "building_id, month and year are required",
        });
      }

      const data = await UtilityService.getPreviousReadings(
        Number(building_id),
        Number(month),
        Number(year)
      );

      res.status(200).json({
        success: true,
        message: "Retrieved previous readings successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/utility/readings/history
   * Lấy TOÀN BỘ lịch sử điện nước các tháng TRƯỚC
   * Dùng cho màn hình xem lịch sử / thống kê
   */
  async getAllPreviousReadings(req, res, next) {
    try {
      const { building_id, month, year } = req.query;

      if (!building_id || !month || !year) {
        return res.status(400).json({
          success: false,
          message: "building_id, month and year are required",
        });
      }

      const data = await UtilityService.getAllPreviousReadings(
        Number(building_id),
        Number(month),
        Number(year)
      );

      res.status(200).json({
        success: true,
        message: "Retrieved all previous utility readings successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/utility/readings
   * Bulk nhập / cập nhật chỉ số điện nước
   */
  async submitReadings(req, res, next) {
    try {
      const userId = req.user.user_id; // From Auth Middleware

      const result = await UtilityService.recordMonthlyReadings(
        userId,
        req.body
      );

      res.status(200).json({
        success: true,
        message: `Successfully recorded readings for ${result.processed} rooms.`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UtilityController();
