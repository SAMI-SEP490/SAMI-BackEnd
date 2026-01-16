// Updated: 2025-12-13
// By: DatNB

const regulationService = require('../services/regulation.service');

class RegulationController {
    // Tạo regulation mới
    async createRegulation(req, res, next) {
        try {
            const createdBy = req.user.user_id;
            const userRole = req.user.role;

            const regulation = await regulationService.createRegulation(
                req.body,
                createdBy,
                userRole
            );

            res.status(201).json({
                success: true,
                message: 'Regulation created successfully',
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin regulation theo ID
    async getRegulationById(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulation = await regulationService.getRegulationById(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách regulations
    async getRegulations(req, res, next) {
        try {
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulations = await regulationService.getRegulations(
                req.query,
                userId,
                userRole
            );

            res.json({
                success: true,
                data: regulations.data,
                pagination: regulations.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy regulations theo building
    async getRegulationsByBuilding(req, res, next) {
        try {
            const { buildingId } = req.params;
            const buildingIdInt = buildingId === 'null' ? null : parseInt(buildingId);
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulations = await regulationService.getRegulationsByBuilding(
                buildingIdInt,
                req.query,
                userId,
                userRole
            );

            res.json({
                success: true,
                data: regulations.data,
                pagination: regulations.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy tất cả versions của một regulation
    async getRegulationVersions(req, res, next) {
        try {
            const { title } = req.params;
            const { building_id } = req.query;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const versions = await regulationService.getRegulationVersions(
                title,
                building_id,
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

    // Cập nhật regulation
    async updateRegulation(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulation = await regulationService.updateRegulation(
                parseInt(id),
                req.body,
                userId,
                userRole
            );

            res.json({
                success: true,
                message: 'Regulation updated successfully',
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Publish regulation
    async publishRegulation(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulation = await regulationService.publishRegulation(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                message: 'Regulation published successfully',
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Unpublish regulation
    async unpublishRegulation(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const regulation = await regulationService.unpublishRegulation(
                parseInt(id),
                userId,
                userRole
            );

            res.json({
                success: true,
                message: 'Regulation unpublished successfully',
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa regulation
    async deleteRegulation(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const result = await regulationService.deleteRegulation(
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

    // Thêm feedback cho regulation
    async addFeedback(req, res, next) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const { comment } = req.body;

            const feedback = await regulationService.addFeedback(
                parseInt(id),
                userId,
                comment
            );

            res.status(201).json({
                success: true,
                message: 'Feedback added successfully',
                data: feedback
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy feedbacks của regulation
    async getFeedbacks(req, res, next) {
        try {
            const { id } = req.params;
            const feedbacks = await regulationService.getFeedbacks(
                parseInt(id),
                req.query
            );

            res.json({
                success: true,
                data: feedbacks.data,
                pagination: feedbacks.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thống kê regulations
    async getRegulationStatistics(req, res, next) {
        try {
            const { buildingId } = req.params;
            const buildingIdInt = buildingId ? parseInt(buildingId) : null;
            const userId = req.user.user_id;
            const userRole = req.user.role;

            const statistics = await regulationService.getRegulationStatistics(
                buildingIdInt,
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

    // ============ BOT ENDPOINTS ============

    async getRegulationsByBot(req, res, next) {
        try {
            const { tenant_user_id } = req.query; // Passed by Bot
            const filters = {
                limit: req.query.limit,
                page: req.query.page
            };

            if (!tenant_user_id) {
                return res.status(400).json({ success: false, message: 'tenant_user_id is required' });
            }

            const result = await regulationService.getRegulationsByBot(
                parseInt(tenant_user_id),
                filters,
                req.bot
            );

            res.json({ success: true, data: result });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new RegulationController();