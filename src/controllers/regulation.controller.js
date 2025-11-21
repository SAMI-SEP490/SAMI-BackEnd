// Updated: 2025-05-11
// By: DatNB

const regulationService = require('../services/regulation.service');

class RegulationController {
    // Tạo regulation mới
    async createRegulation(req, res, next) {
        try {
            const createdBy = req.user.user_id; // Lấy từ authentication middleware
            const regulation = await regulationService.createRegulation(req.body, createdBy);

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
            const regulation = await regulationService.getRegulationById(parseInt(id));

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
            const regulations = await regulationService.getRegulations(req.query);

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

            const regulations = await regulationService.getRegulationsByBuilding(
                buildingIdInt,
                req.query
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

            const versions = await regulationService.getRegulationVersions(
                title,
                building_id
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
            const regulation = await regulationService.updateRegulation(
                parseInt(id),
                req.body
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
            const regulation = await regulationService.publishRegulation(parseInt(id));

            res.json({
                success: true,
                message: 'Regulation published successfully',
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    // Archive regulation
    async archiveRegulation(req, res, next) {
        try {
            const { id } = req.params;
            const regulation = await regulationService.archiveRegulation(parseInt(id));

            res.json({
                success: true,
                message: 'Regulation archived successfully',
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
            const result = await regulationService.deleteRegulation(parseInt(id));

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

            const statistics = await regulationService.getRegulationStatistics(buildingIdInt);

            res.json({
                success: true,
                data: statistics
            });
        } catch (err) {
            next(err);
        }
    }

    // ============ BOT ENDPOINTS ============

    /**
     * Bot lấy thông tin regulation
     */
    async getRegulationByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id } = req.query;

            if (tenant_user_id && !Number.isInteger(parseInt(tenant_user_id))) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id must be an integer'
                });
            }

            const regulation = await regulationService.getRegulationByBot(
                parseInt(id),
                tenant_user_id ? parseInt(tenant_user_id) : null,
                req.bot
            );

            res.json({
                success: true,
                data: regulation
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy danh sách regulations với filter
     */
    async getRegulationsByBot(req, res, next) {
        try {
            const filters = {
                building_id: req.query.building_id,
                status: req.query.status,
                target: req.query.target,
                version: req.query.version,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await regulationService.getRegulationsByBot(
                filters,
                req.bot
            );

            res.json({
                success: true,
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy regulations theo building
     */
    async getRegulationsByBuildingForBot(req, res, next) {
        try {
            const { buildingId } = req.params;
            const buildingIdInt = buildingId === 'null' ? null : parseInt(buildingId);

            const filters = {
                status: req.query.status,
                target: req.query.target,
                latest_only: req.query.latest_only,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await regulationService.getRegulationsByBuildingForBot(
                buildingIdInt,
                filters,
                req.bot
            );

            res.json({
                success: true,
                data: result
            });
        } catch (err) {
            next(err);
        }
    }



    /**
     * Bot thêm feedback cho regulation thay mặt tenant
     */
    async addRegulationFeedbackByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id, comment } = req.body;

            const feedback = await regulationService.addRegulationFeedbackByBot(
                parseInt(id),
                tenant_user_id,
                comment,
                req.bot
            );

            console.log(`[BOT] Added feedback to regulation ${id} for tenant ${tenant_user_id}`);

            res.status(201).json({
                success: true,
                message: 'Feedback added successfully by bot',
                data: feedback,
                bot_info: {
                    created_by: req.bot.name,
                    created_at: req.bot.authenticated_at
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy feedbacks của regulation
     */
    async getRegulationFeedbacksByBot(req, res, next) {
        try {
            const { id } = req.params;

            const filters = {
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await regulationService.getRegulationFeedbacksByBot(
                parseInt(id),
                filters,
                req.bot
            );

            res.json({
                success: true,
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy versions của regulation
     */
    async getRegulationVersionsByBot(req, res, next) {
        try {
            const { title } = req.params;
            const { building_id } = req.query;

            const versions = await regulationService.getRegulationVersionsByBot(
                title,
                building_id,
                req.bot
            );

            res.json({
                success: true,
                data: versions
            });
        } catch (err) {
            next(err);
        }
    }


}

module.exports = new RegulationController();