// Updated: 2025-31-10
// By: DatNB

const buildingService = require('../services/building.service');

class BuildingController {
    // Tạo tòa nhà mới
    async createBuilding(req, res, next) {
        try {
            const building = await buildingService.createBuilding(req.body);

            res.status(201).json({
                success: true,
                message: 'Building created successfully',
                data: building
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin tòa nhà theo ID
    async getBuildingById(req, res, next) {
        try {
            const { id } = req.params;
            const building = await buildingService.getBuildingById(parseInt(id));

            res.json({
                success: true,
                data: building
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách tòa nhà
    async getBuildings(req, res, next) {
        try {
            const buildings = await buildingService.getBuildings(req.query);

            res.json({
                success: true,
                data: buildings.data,
                pagination: buildings.pagination
            });
        } catch (err) {
            next(err);
        }
    }
// [NEW] Lấy danh sách tòa nhà của Manager đang đăng nhập
    async getAssignedBuildings(req, res, next) {
        try {
            // Lấy ID từ token (auth middleware)
            const userId = req.user.userId || req.user.id || req.user.user_id;

            if (!userId) {
                throw new Error('User ID not found in request');
            }

            const buildings = await buildingService.getAssignedBuildings(parseInt(userId));

            res.json({
                success: true,
                data: buildings
            });
        } catch (err) {
            next(err);
        }
    }
    // Cập nhật tòa nhà
    async updateBuilding(req, res, next) {
        try {
            const { id } = req.params;
            const building = await buildingService.updateBuilding(parseInt(id), req.body);

            res.json({
                success: true,
                message: 'Building updated successfully',
                data: building
            });
        } catch (err) {
            next(err);
        }
    }

    // Vô hiệu hóa tòa nhà
    async deactivateBuilding(req, res, next) {
        try {
            const { id } = req.params;
            const result = await buildingService.deactivateBuilding(parseInt(id));

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Kích hoạt lại tòa nhà
    async activateBuilding(req, res, next) {
        try {
            const { id } = req.params;
            const building = await buildingService.activateBuilding(parseInt(id));

            res.json({
                success: true,
                message: 'Building activated successfully',
                data: building
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa vĩnh viễn tòa nhà
    async hardDeleteBuilding(req, res, next) {
        try {
            const { id } = req.params;
            const result = await buildingService.hardDeleteBuilding(parseInt(id));

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thống kê tòa nhà
    async getBuildingStatistics(req, res, next) {
        try {
            const { id } = req.params;
            const statistics = await buildingService.getBuildingStatistics(parseInt(id));

            res.json({
                success: true,
                data: statistics
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách building managers
    async getBuildingManagers(req, res, next) {
        try {
            const { id } = req.params;
            const managers = await buildingService.getBuildingManagers(
                parseInt(id),
                req.query
            );

            res.json({
                success: true,
                data: managers.data,
                pagination: managers.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Gán manager cho tòa nhà
    async assignManager(req, res, next) {
        try {
            const { id } = req.params;
            const assignment = await buildingService.assignManager(
                parseInt(id),
                req.body
            );

            res.status(201).json({
                success: true,
                message: 'Manager assigned to building successfully',
                data: assignment
            });
        } catch (err) {
            next(err);
        }
    }

    // Cập nhật thông tin assignment
    async updateManagerAssignment(req, res, next) {
        try {
            const { id, userId } = req.params;
            const assignment = await buildingService.updateManagerAssignment(
                parseInt(id),
                parseInt(userId),
                req.body
            );

            res.json({
                success: true,
                message: 'Manager assignment updated successfully',
                data: assignment
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa manager khỏi tòa nhà
    async removeManager(req, res, next) {
        try {
            const { id, userId } = req.params;
            const result = await buildingService.removeManager(
                parseInt(id),
                parseInt(userId)
            );

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    async getMyBuildingDetails(req, res, next) {
        try {
            const userId = req.user.userId || req.user.id || req.user.user_id;

            if (!userId) {
                throw new Error('User ID not found in request');
            }

            const data = await buildingService.getMyBuildingDetails(parseInt(userId));

            res.json({
                success: true,
                data: data
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new BuildingController();