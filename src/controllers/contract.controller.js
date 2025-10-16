// Updated: 2025-16-10
// By: DatNB

const contractService = require('../services/contract.service');

class ContractController {
    async create(req, res, next) {
        try {
            const contract = await contractService.createContract(req.body);
            res.status(201).json({
                success: true,
                message: 'Contract created successfully',
                data: { contract }
            });
        } catch (err) {
            next(err);
        }
    }

    async getById(req, res, next) {
        try {
            const { contractId } = req.params;
            const contract = await contractService.getContractById(parseInt(contractId));
            res.json({
                success: true,
                data: { contract }
            });
        } catch (err) {
            next(err);
        }
    }

    async getAll(req, res, next) {
        try {
            const result = await contractService.getContracts(req.query);
            res.json({
                success: true,
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    async update(req, res, next) {
        try {
            const { contractId } = req.params;
            const contract = await contractService.updateContract(parseInt(contractId), req.body);
            res.json({
                success: true,
                message: 'Contract updated successfully',
                data: { contract }
            });
        } catch (err) {
            next(err);
        }
    }

    async delete(req, res, next) {
        try {
            const { contractId } = req.params;
            await contractService.deleteContract(parseInt(contractId));
            res.json({
                success: true,
                message: 'Contract deleted successfully'
            });
        } catch (err) {
            next(err);
        }
    }

    async restore(req, res, next) {
        try {
            const { contractId } = req.params;
            const contract = await contractService.restoreContract(parseInt(contractId));
            res.json({
                success: true,
                message: 'Contract restored successfully',
                data: { contract }
            });
        } catch (err) {
            next(err);
        }
    }

    async terminate(req, res, next) {
        try {
            const { contractId } = req.params;
            const { reason } = req.body;
            const contract = await contractService.terminateContract(parseInt(contractId), reason);
            res.json({
                success: true,
                message: 'Contract terminated successfully',
                data: { contract }
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ContractController();