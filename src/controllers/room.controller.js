// Updated: 2025-11-06
// By: DatNB

const roomService = require('../services/room.service');

class RoomController {
    // Tạo phòng mới
    async createRoom(req, res, next) {
        try {
            const room = await roomService.createRoom(req.body);

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
            const room = await roomService.getRoomById(parseInt(id));

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
            const rooms = await roomService.getRooms(req.query);

            res.json({
                success: true,
                data: rooms.data,
                pagination: rooms.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin phòng theo user_id (tenant)
    async getRoomsByUserId(req, res, next) {
        try {
            const { userId } = req.params;
            const rooms = await roomService.getRoomsByUserId(parseInt(userId));

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
            const room = await roomService.updateRoom(parseInt(id), req.body);

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
            const result = await roomService.deactivateRoom(parseInt(id));

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
            const room = await roomService.activateRoom(parseInt(id));

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
            const result = await roomService.hardDeleteRoom(parseInt(id));

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
            const statistics = await roomService.getRoomStatisticsByBuilding(parseInt(buildingId));

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