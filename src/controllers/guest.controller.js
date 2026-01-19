// Updated: 2025-10-24
// by: DatNB

const guestService = require('../services/guest.service');

class GuestController {
    // Create guest registration (Tenant only)
    async createGuestRegistration(req, res, next) {
        try {
            const registration = await guestService.createGuestRegistration(
                req.user.user_id,
                req.body
            );

            res.status(201).json({
                success: true,
                message: 'Guest registration created successfully',
                data: { registration }
            });
        } catch (err) {
            next(err);
        }
    }

    // Get guest registration by ID
    async getGuestRegistrationById(req, res, next) {
        try {
            const { id } = req.params;

            const registration = await guestService.getGuestRegistrationById(
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

    // Get all guest registrations with filters
    async getGuestRegistrations(req, res, next) {
        try {
            const filters = {
                status: req.query.status,
                host_user_id: req.query.host_user_id
                    ? Number(req.query.host_user_id)
                    : undefined,
                room_id: req.query.room_id
                    ? Number(req.query.room_id)
                    : undefined,
                building_id: req.query.building_id
                    ? Number(req.query.building_id)
                    : undefined,
                arrival_date_from: req.query.arrival_date_from,
                arrival_date_to: req.query.arrival_date_to,
                page: req.query.page ? Number(req.query.page) : 1,
                limit: req.query.limit ? Number(req.query.limit) : 10,
            };

            const result = await guestService.getGuestRegistrations(
                filters,
                req.user // ✅ truyền full user
            );

            res.json({
                success: true,
                data: result,
            });
        } catch (err) {
            next(err);
        }
    }

    // Update guest registration (Tenant only, pending status only)
    async updateGuestRegistration(req, res, next) {
        try {
            const { id } = req.params;

            const updated = await guestService.updateGuestRegistration(
                parseInt(id),
                req.user.user_id,
                req.body
            );

            res.json({
                success: true,
                message: 'Guest registration updated successfully',
                data: { registration: updated }
            });
        } catch (err) {
            next(err);
        }
    }

    // Approve guest registration (Manager/Owner only)
    async approveGuestRegistration(req, res, next) {
        try {
            const { id } = req.params;

            const approved = await guestService.approveGuestRegistration(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Guest registration approved successfully',
                data: { registration: approved }
            });
        } catch (err) {
            next(err);
        }
    }

    // Reject guest registration (Manager/Owner only)
    async rejectGuestRegistration(req, res, next) {
        try {
            const { id } = req.params;
            const { rejection_reason } = req.body;

            const rejected = await guestService.rejectGuestRegistration(
                parseInt(id),
                req.user.user_id,
                rejection_reason
            );

            res.json({
                success: true,
                message: 'Guest registration rejected successfully',
                data: { registration: rejected }
            });
        } catch (err) {
            next(err);
        }
    }

    // Cancel guest registration
    async cancelGuestRegistration(req, res, next) {
        try {
            const { id } = req.params;
            const { cancellation_reason } = req.body;

            const cancelled = await guestService.cancelGuestRegistration(
                parseInt(id),
                req.user.user_id,
                req.user.role,
                cancellation_reason
            );

            res.json({
                success: true,
                message: 'Guest registration cancelled successfully',
                data: { registration: cancelled }
            });
        } catch (err) {
            next(err);
        }
    }

    // Delete guest registration
    async deleteGuestRegistration(req, res, next) {
        try {
            const { id } = req.params;

            await guestService.deleteGuestRegistration(
                parseInt(id),
                req.user.user_id
            );

            res.json({
                success: true,
                message: 'Guest registration deleted successfully'
            });
        } catch (err) {
            next(err);
        }
    }

    // Get statistics
    async getGuestRegistrationStats(req, res, next) {
        try {
            const stats = await guestService.getGuestRegistrationStats(
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

module.exports = new GuestController();