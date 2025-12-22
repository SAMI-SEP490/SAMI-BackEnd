// Updated: 2025-12-12
// By: DatNB
// Added: Pass user role and id to service for RBAC

const roomService = require('../services/room.service');

class RoomController {
    // Tạo phòng mới
    async createRoom(req, res, next) {
        try {
            const { role, userId } = req.user; // Lấy từ middleware auth
            const room = await roomService.createRoom(req.body, role, userId);

            res.status(201).json({
                success: true,
                message: 'Room created successfully',
                data: room
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin phòng theo ID
    async getRoomById(req, res, next) {
        try {
            const { id } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const room = await roomService.getRoomById(parseInt(id), role, userId);

            res.json({
                success: true,
                data: room
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách phòng
    async getRooms(req, res, next) {
        try {
            const { role, userId } = req.user; // Lấy từ middleware auth
            const rooms = await roomService.getRooms(req.query, role, userId);

            res.json({
                success: true,
                data: rooms.data,
                pagination: rooms.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    async getRoomsByUserId(req, res, next) {
        try {
            const { userId } = req.params;
            const { role, userId: reqUserId } = req.user;
            const rooms = await roomService.getRoomsByUserId(parseInt(userId), role, reqUserId);

            res.json({
                success: true,
                data: rooms
            });
        } catch (err) {
            next(err);
        }
    }

    // Cập nhật phòng
    async updateRoom(req, res, next) {
        try {
            const { id } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const room = await roomService.updateRoom(parseInt(id), req.body, role, userId);

            res.json({
                success: true,
                message: 'Room updated successfully',
                data: room
            });
        } catch (err) {
            next(err);
        }
    }

    // Vô hiệu hóa phòng
    async deactivateRoom(req, res, next) {
        try {
            const { id } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const result = await roomService.deactivateRoom(parseInt(id), role, userId);

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Kích hoạt lại phòng
    async activateRoom(req, res, next) {
        try {
            const { id } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const room = await roomService.activateRoom(parseInt(id), role, userId);

            res.json({
                success: true,
                message: 'Room activated successfully',
                data: room
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa vĩnh viễn phòng
    async hardDeleteRoom(req, res, next) {
        try {
            const { id } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const result = await roomService.hardDeleteRoom(parseInt(id), role, userId);

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thống kê phòng theo building
    async getRoomStatisticsByBuilding(req, res, next) {
        try {
            const { buildingId } = req.params;
            const { role, userId } = req.user; // Lấy từ middleware auth
            const statistics = await roomService.getRoomStatisticsByBuilding(
                parseInt(buildingId),
                role,
                userId
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

module.exports = new RoomController();