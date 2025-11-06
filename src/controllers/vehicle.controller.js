// Updated: 2025-11-06
// by: DatNB

const vehicleService = require('../services/vehicle.service');

class VehicleController {
    // Register vehicle (Tenant only)
    async registerVehicle(req, res, next) {
        try {
            const vehicle = await vehicleService.registerVehicle(
                req.user.user_id,
                req.body
            );

            res.status(201).json({
                success: true,
                message: 'Vehicle registered successfully',
                data: { vehicle }
            });
        } catch (err) {
            next(err);
        }
    }

    // Get vehicle by ID
    async getVehicleById(req, res, next) {
        try {
            const { id } = req.params;

            const vehicle = await vehicleService.getVehicleById(
                parseInt(id),
                req.user.user_id,
                req.user.role
            );

            res.json({
                success: true,
                data: { vehicle }
            });
        } catch (err) {
            next(err);
        }
    }

    // Get all vehicles with filters
    async getVehicles(req, res, next) {
        try {
            const filters = {
                status: req.query.status,
                type: req.query.type,
                tenant_user_id: req.query.tenant_user_id ? parseInt(req.query.tenant_user_id) : undefined,
                license_plate: req.query.license_plate,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await vehicleService.getVehicles(
                filters,
                req.user.user_id,
                req.user.role
            );

            res.json({
                success: true,
                data: result
            });
        } catch (err) {
            next(err);
        }
    }

    // Update vehicle (Tenant only, requested status only)
    async updateVehicle(req, res, next) {
        try {
            const { id } = req.params;

            const updated = await vehicleService.updateVehicle(
                parseInt(id),
                req.user.user_id,
                req.body
            );

            res.json({
                success: true,
                message: 'Vehicle updated successfully',
                data: { vehicle: updated }
            });
        } catch (err) {
            next(err);
        }
    }

    // Approve vehicle (Manager/Owner only)
    async approveVehicle(req, res, next) {
        try {
            const { id } = req.params;

            const approved = await vehicleService.approveVehicle(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle approved successfully',
                data: { vehicle: approved }
            });
        } catch (err) {
            next(err);
        }
    }

    // Reject vehicle (Manager/Owner only)
    async rejectVehicle(req, res, next) {
        try {
            const { id } = req.params;

            const rejected = await vehicleService.rejectVehicle(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle rejected successfully',
                data: { vehicle: rejected }
            });
        } catch (err) {
            next(err);
        }
    }

    // Deactivate vehicle (Manager/Owner only)
    async deactivateVehicle(req, res, next) {
        try {
            const { id } = req.params;

            const deactivated = await vehicleService.deactivateVehicle(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle deactivated successfully',
                data: { vehicle: deactivated }
            });
        } catch (err) {
            next(err);
        }
    }

    // Delete vehicle
    async deleteVehicle(req, res, next) {
        try {
            const { id } = req.params;

            await vehicleService.deleteVehicle(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle deleted successfully'
            });
        } catch (err) {
            next(err);
        }
    }

    // Get statistics
    async getVehicleStats(req, res, next) {
        try {
            const stats = await vehicleService.getVehicleStats(
                req.user.user_id,
                req.user.role
            );

            res.json({
                success: true,
                data: { stats }
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new VehicleController();