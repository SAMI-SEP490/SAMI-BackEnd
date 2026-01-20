const parkingSlotService = require('../services/parking-slot.service');

class ParkingSlotController {

    // =========================
    // CREATE
    // =========================
    async createParkingSlot(req, res, next) {
        try {
            const slot = await parkingSlotService.createParkingSlot(req.body);

            res.status(201).json({
                success: true,
                message: 'Parking slot created successfully',
                data: { slot }
            });
        } catch (err) {
            next(err);
        }
    }

    // =========================
    // READ - LIST
    // =========================
    async getParkingSlots(req, res, next) {
        try {
            const slots = await parkingSlotService.getParkingSlots(
                req.query,
                req.user
            );

            res.json({
                success: true,
                data: { slots }
            });
        } catch (err) {
            next(err);
        }
    }

    // GET buildings for parking slot page
    async getBuildingsForParking(req, res, next) {
        try {
            const buildings = await parkingSlotService.getBuildingsForParking(req.user);

            res.json({
                success: true,
                data: buildings
            });
        } catch (err) {
            console.log("REQ USER:", req.user);
            next(err);
        }
    }

    // =========================
    // READ - AVAILABLE
    // =========================
    async getAvailableParkingSlotForRegistration(req, res, next) {
        try {
            const { registration_id } = req.query;

            if (!registration_id) {
                throw new Error("registration_id is required");
            }

            const slots = await parkingSlotService.getAvailableSlotForRegistration(
                registration_id
            );

            res.json({
                success: true,
                data: { slots }
            });
        } catch (err) {
            next(err);
        }
    }
    async getAvailableSlotsForVehicle(req, res, next) {
        try {
            const { vehicle_id } = req.query;

            if (!vehicle_id) {
                throw new Error("vehicle_id is required");
            }

            const slots = await parkingSlotService.getAvailableSlotsForVehicle(
                Number(vehicle_id),
                req.user.user_id,
                req.user.role
            );

            res.json({
                success: true,
                data: { slots }
            });
        } catch (err) {
            next(err);
        }
    }
    // =========================
    // READ - BY ID
    // =========================
    async getParkingSlotById(req, res, next) {
        try {
            const slot = await parkingSlotService.getParkingSlotById(
                parseInt(req.params.id)
            );

            res.json({
                success: true,
                data: { slot }
            });
        } catch (err) {
            next(err);
        }
    }

    // =========================
    // UPDATE
    // =========================
    async updateParkingSlot(req, res, next) {
        try {
            const slot = await parkingSlotService.updateParkingSlot(
                parseInt(req.params.id),
                req.body
            );

            res.json({
                success: true,
                message: 'Parking slot updated successfully',
                data: { slot }
            });
        } catch (err) {
            next(err);
        }
    }

    // =========================
    // DELETE
    // =========================
    async deleteParkingSlot(req, res, next) {
        try {
            await parkingSlotService.deleteParkingSlot(
                parseInt(req.params.id)
            );

            res.json({
                success: true,
                message: 'Parking slot deleted successfully'
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ParkingSlotController();
