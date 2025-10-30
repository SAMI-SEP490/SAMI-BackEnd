// Updated: 2025-30-10
// By: DatNB

const maintenanceService = require('../services/maintenance.service');

class MaintenanceController {
    // Tạo yêu cầu bảo trì mới
    async createMaintenanceRequest(req, res, next) {
        try {
            const maintenanceRequest = await maintenanceService.createMaintenanceRequest(
                req.body,
                req.user
            );

            res.status(201).json({
                success: true,
                message: 'Maintenance request created successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin yêu cầu bảo trì theo ID
    async getMaintenanceRequestById(req, res, next) {
        try {
            const { id } = req.params;
            const maintenanceRequest = await maintenanceService.getMaintenanceRequestById(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách yêu cầu bảo trì
    async getMaintenanceRequests(req, res, next) {
        try {
            const maintenanceRequests = await maintenanceService.getMaintenanceRequests(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: maintenanceRequests.data,
                pagination: maintenanceRequests.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Cập nhật yêu cầu bảo trì
    async updateMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;
            const maintenanceRequest = await maintenanceService.updateMaintenanceRequest(
                parseInt(id),
                req.body,
                req.user
            );

            res.json({
                success: true,
                message: 'Maintenance request updated successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa yêu cầu bảo trì
    async deleteMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;
            const result = await maintenanceService.deleteMaintenanceRequest(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Phê duyệt yêu cầu bảo trì
    async approveMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;
            const maintenanceRequest = await maintenanceService.approveMaintenanceRequest(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: 'Maintenance request approved successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Từ chối yêu cầu bảo trì
    async rejectMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;
            const { reason } = req.body;

            const maintenanceRequest = await maintenanceService.rejectMaintenanceRequest(
                parseInt(id),
                reason,
                req.user
            );

            res.json({
                success: true,
                message: 'Maintenance request rejected successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Đánh dấu đã giải quyết
    async resolveMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;


            const maintenanceRequest = await maintenanceService.resolveMaintenanceRequest(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: 'Maintenance request resolved successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Đánh dấu hoàn thành
    async completeMaintenanceRequest(req, res, next) {
        try {
            const { id } = req.params;
            const maintenanceRequest = await maintenanceService.completeMaintenanceRequest(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                message: 'Maintenance request completed successfully',
                data: maintenanceRequest
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy lịch sử bảo trì của một phòng
    async getRoomMaintenanceHistory(req, res, next) {
        try {
            const { roomId } = req.params;
            const history = await maintenanceService.getRoomMaintenanceHistory(
                parseInt(roomId),
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: history
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thống kê tổng quan maintenance
    async getMaintenanceStatistics(req, res, next) {
        try {
            const statistics = await maintenanceService.getMaintenanceStatistics(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: statistics
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new MaintenanceController();