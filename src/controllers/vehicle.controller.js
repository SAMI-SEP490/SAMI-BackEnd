// Updated: 2025-11-06
// by: DatNB

const vehicleRegistrationService = require('../services/vehicle.service');

class VehicleRegistrationController {
    // Create vehicle registration (Tenant only)
    async createVehicleRegistration(req, res, next) {
        try {
            const registration = await vehicleRegistrationService.createVehicleRegistration(
                req.user.user_id,
                req.body
            );

            res.status(201).json({
                success: true,
                message: 'Vehicle registration created successfully',
                data: { registration }
            });
        } catch (err) {
            next(err);
        }
    }

    // Get vehicle registration by ID
    async getVehicleRegistrationById(req, res, next) {
        try {
            const { id } = req.params;

            const registration = await vehicleRegistrationService.getVehicleRegistrationById(
                parseInt(id),
                req.user.user_id,
                req.user.role
            );

            res.json({
                success: true,
                data: { registration }
            });
        } catch (err) {
            next(err);
        }
    }

    // Get all vehicle registrations with filters
    async getVehicleRegistrations(req, res, next) {
        try {
            const filters = {
                status: req.query.status,
                requested_by: req.query.requested_by ? parseInt(req.query.requested_by) : undefined,
                start_date_from: req.query.start_date_from,
                start_date_to: req.query.start_date_to,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await vehicleRegistrationService.getVehicleRegistrations(
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

    // Update vehicle registration (Tenant only, requested status only)
    async updateVehicleRegistration(req, res, next) {
        try {
            const { id } = req.params;

            const updated = await vehicleRegistrationService.updateVehicleRegistration(
                parseInt(id),
                req.user.user_id,
                req.body
            );

            res.json({
                success: true,
                message: 'Vehicle registration updated successfully',
                data: { registration: updated }
            });
        } catch (err) {
            next(err);
        }
    }

    // Approve vehicle registration (Manager/Owner only)
    async approveVehicleRegistration(req, res, next) {
        try {
            const { id } = req.params;

            const approved = await vehicleRegistrationService.approveVehicleRegistration(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle registration approved and vehicle created successfully',
                data: { registration: approved }
            });
        } catch (err) {
            next(err);
        }
    }

// Reject vehicle registration (Manager/Owner only)
    async rejectVehicleRegistration(req, res, next) {
        try {
            const { id } = req.params;
            const { rejection_reason } = req.body; // Thêm lý do từ chối

            const rejected = await vehicleRegistrationService.rejectVehicleRegistration(
                parseInt(id),
                req.user.user_id,
                rejection_reason // Thêm tham số này
            );

            res.json({
                success: true,
                message: 'Vehicle registration rejected successfully',
                data: { registration: rejected }
            });
        } catch (err) {
            next(err);
        }
    }

    // Cancel vehicle registration
    async cancelVehicleRegistration(req, res, next) {
        try {
            const { id } = req.params;
            const { cancellation_reason } = req.body;

            const cancelled = await vehicleRegistrationService.cancelVehicleRegistration(
                parseInt(id),
                req.user.user_id,
                req.user.role,
                cancellation_reason
            );

            res.json({
                success: true,
                message: 'Vehicle registration cancelled successfully',
                data: { registration: cancelled }
            });
        } catch (err) {
            next(err);
        }
    }

    // Delete vehicle registration
    async deleteVehicleRegistration(req, res, next) {
        try {
            const { id } = req.params;

            await vehicleRegistrationService.deleteVehicleRegistration(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Vehicle registration deleted successfully'
            });
        } catch (err) {
            next(err);
        }
    }

    // Get statistics
    async getVehicleRegistrationStats(req, res, next) {
        try {
            const stats = await vehicleRegistrationService.getVehicleRegistrationStats(
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

    // Get all vehicles
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

            const result = await vehicleRegistrationService.getVehicles(
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

    // Get vehicle by ID
    async getVehicleById(req, res, next) {
        try {
            const { id } = req.params;

            const vehicle = await vehicleRegistrationService.getVehicleById(
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

    // ============ BOT ENDPOINTS ============

    /**
     * Bot tạo vehicle registration thay mặt tenant
     */
    async createVehicleRegistrationByBot(req, res, next) {
        try {
            const { tenant_user_id, ...registrationData } = req.body;

            const registration = await vehicleRegistrationService.createVehicleRegistrationByBot(
                tenant_user_id,
                registrationData,
                req.bot
            );

            console.log(`[BOT] Created vehicle registration ${registration.assignment_id} for tenant ${tenant_user_id}`);

            res.status(201).json({
                success: true,
                message: 'Vehicle registration created successfully by bot',
                data: { registration },
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
     * Bot cập nhật vehicle registration thay mặt tenant
     */
    async updateVehicleRegistrationByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id, ...updateData } = req.body;

            const registration = await vehicleRegistrationService.updateVehicleRegistrationByBot(
                parseInt(id),
                tenant_user_id,
                updateData,
                req.bot
            );

            console.log(`[BOT] Updated vehicle registration ${id} for tenant ${tenant_user_id}`);

            res.json({
                success: true,
                message: 'Vehicle registration updated successfully by bot',
                data: { registration },
                bot_info: {
                    updated_by: req.bot.name,
                    updated_at: req.bot.authenticated_at
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot xóa vehicle registration thay mặt tenant
     */
    async deleteVehicleRegistrationByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id } = req.body;

            const result = await vehicleRegistrationService.deleteVehicleRegistrationByBot(
                parseInt(id),
                tenant_user_id,
                req.bot
            );

            console.log(`[BOT] Deleted vehicle registration ${id} for tenant ${tenant_user_id}`);

            res.json({
                success: true,
                message: 'Vehicle registration deleted successfully by bot',
                data: result,
                bot_info: {
                    deleted_by: req.bot.name,
                    deleted_at: req.bot.authenticated_at
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot cancel vehicle registration thay mặt tenant
     */
    async cancelVehicleRegistrationByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id, cancellation_reason } = req.body;

            const registration = await vehicleRegistrationService.cancelVehicleRegistrationByBot(
                parseInt(id),
                tenant_user_id,
                cancellation_reason,
                req.bot
            );

            console.log(`[BOT] Cancelled vehicle registration ${id} for tenant ${tenant_user_id}`);

            res.json({
                success: true,
                message: 'Vehicle registration cancelled successfully by bot',
                data: { registration },
                bot_info: {
                    cancelled_by: req.bot.name,
                    cancelled_at: req.bot.authenticated_at
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy thông tin vehicle registration
     */
    async getVehicleRegistrationByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            const registration = await vehicleRegistrationService.getVehicleRegistrationByBot(
                parseInt(id),
                parseInt(tenant_user_id),
                req.bot
            );

            res.json({
                success: true,
                data: { registration }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy danh sách vehicle registrations của tenant
     */
    async getVehicleRegistrationsByBot(req, res, next) {
        try {
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            const filters = {
                status: req.query.status,
                start_date_from: req.query.start_date_from,
                start_date_to: req.query.start_date_to,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await vehicleRegistrationService.getVehicleRegistrationsByBot(
                parseInt(tenant_user_id),
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
     * Bot lấy danh sách vehicles của tenant
     */
    async getVehiclesByBot(req, res, next) {
        try {
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            const filters = {
                status: req.query.status,
                type: req.query.type,
                license_plate: req.query.license_plate,
                page: req.query.page,
                limit: req.query.limit
            };

            const result = await vehicleRegistrationService.getVehiclesByBot(
                parseInt(tenant_user_id),
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
     * Bot lấy thông tin vehicle
     */
    async getVehicleByBot(req, res, next) {
        try {
            const { id } = req.params;
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            const vehicle = await vehicleRegistrationService.getVehicleByBot(
                parseInt(id),
                parseInt(tenant_user_id),
                req.bot
            );

            res.json({
                success: true,
                data: { vehicle }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Bot lấy thống kê vehicle của tenant
     */
    async getVehicleStatsByBot(req, res, next) {
        try {
            const { tenant_user_id } = req.query;

            if (!tenant_user_id) {
                return res.status(400).json({
                    success: false,
                    message: 'tenant_user_id is required as query parameter'
                });
            }

            const stats = await vehicleRegistrationService.getVehicleStatsByBot(
                parseInt(tenant_user_id),
                req.bot
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

module.exports = new VehicleRegistrationController();