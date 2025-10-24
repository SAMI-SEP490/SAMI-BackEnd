// Updated: 2025-24-10
// By: Datnb

const contractAddendumService = require('../services/addendum.service');

class ContractAddendumController {
    // Tạo phụ lục hợp đồng mới
    async createAddendum(req, res, next) {
        try {
            const addendum = await contractAddendumService.createAddendum(
                req.body,
                req.user
            );

            res.status(201).json({
                success: true,
                message: 'Contract addendum created successfully',
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy thông tin phụ lục theo ID
    async getAddendumById(req, res, next) {
        try {
            const { id } = req.params;
            const addendum = await contractAddendumService.getAddendumById(
                parseInt(id),
                req.user
            );

            res.json({
                success: true,
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy danh sách phụ lục
    async getAddendums(req, res, next) {
        try {
            const addendums = await contractAddendumService.getAddendums(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: addendums.data,
                pagination: addendums.pagination
            });
        } catch (err) {
            next(err);
        }
    }

    // Lấy tất cả phụ lục của một hợp đồng
    async getAddendumsByContract(req, res, next) {
        try {
            const { contract_id } = req.params;
            const addendums = await contractAddendumService.getAddendumsByContract(
                parseInt(contract_id),
                req.user
            );

            res.json({
                success: true,
                data: addendums
            });
        } catch (err) {
            next(err);
        }
    }

    // Cập nhật phụ lục
    async updateAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const addendum = await contractAddendumService.updateAddendum(
                parseInt(id),
                req.body,
                req.user
            );

            res.json({
                success: true,
                message: 'Contract addendum updated successfully',
                data: addendum
            });
        } catch (err) {
            next(err);
        }
    }

    // Xóa phụ lục
    async deleteAddendum(req, res, next) {
        try {
            const { id } = req.params;
            const result = await contractAddendumService.deleteAddendum(parseInt(id));

            res.json({
                success: true,
                message: result.message
            });
        } catch (err) {
            next(err);
        }
    }

    // Thống kê phụ lục
    async getAddendumStatistics(req, res, next) {
        try {
            const { contract_id } = req.query;
            const stats = await contractAddendumService.getAddendumStatistics(
                contract_id ? parseInt(contract_id) : null
            );

            res.json({
                success: true,
                data: stats
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ContractAddendumController();