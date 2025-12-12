// Updated: 2025-12-12
// By: DatNB

const floorPlanService = require('../services/floor-plan.service');

class FloorPlanController {
    // Tạo floor plan mới
    async createFloorPlan(req, res, next) {
        try {
            const userId = req.user.user_id;
            const userRole = req.user.role;

            // Chỉ OWNER và MANAGER mới có quyền tạo floor plan
            if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: Only owners and managers can create floor plans'
                });
            }

            const floorPlan = await floorPlanService.createFloorPlan(
                req.body,
                userId,
                userRole
            );

            res.status(201).json({
                success: true,
                message: 'Floor plan created successfully',
                data: floorPlan
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin floor plan theo ID
    async getFloorPlanById(req, res, next) {
        try {
            const { id } = req.params;
            const floorPlan = await floorPlanService.getFloorPlanById(parseInt(id));

            res.json({
                success: true,
                data: floorPlan
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
                data: floorPlans.data,
                pagination: floorPlans.pagination
            });
        } catch (err) {
            next(err);
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
                data: floorPlans.data,
                pagination: floorPlans.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy tất cả versions của một floor
    async getFloorPlanVersions(req, res, next) {
        try {
            const { buildingId, floorNumber } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const versions = await floorPlanService.getFloorPlanVersions(
                buildingId,
                floorNumber,
                userId,
                userRole
            );

            res.json({
                success: true,
                data: versions
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

            // Chỉ OWNER và MANAGER mới có quyền cập nhật floor plan
            if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: Only owners and managers can update floor plans'
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
                message: 'Floor plan updated successfully',
                data: floorPlan
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

            // Chỉ OWNER và MANAGER mới có quyền publish floor plan
            if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: Only owners and managers can publish floor plans'
                });
            }

            const floorPlan = await floorPlanService.publishFloorPlan(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                message: 'Floor plan published successfully',
                data: floorPlan
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

            // Chỉ OWNER và MANAGER mới có quyền unpublish floor plan
            if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: Only owners and managers can unpublish floor plans'
                });
            }

            const floorPlan = await floorPlanService.unpublishFloorPlan(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                message: 'Floor plan unpublished successfully',
                data: floorPlan
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

            // Chỉ OWNER và MANAGER mới có quyền xóa floor plan
            if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: Only owners and managers can delete floor plans'
                });
            }

            const result = await floorPlanService.deleteFloorPlan(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thống kê floor plans
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
                data: statistics
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new FloorPlanController();