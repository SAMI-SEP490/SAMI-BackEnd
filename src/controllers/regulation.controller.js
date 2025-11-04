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
}

module.exports = new RegulationController();