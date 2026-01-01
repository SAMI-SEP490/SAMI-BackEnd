// src/controllers/utility.controller.js
// Created: 2026-01-01

const UtilityService = require('../services/utility.service');

class UtilityController {

    /**
     * GET /api/utility/readings
     * Get list of rooms with their PREVIOUS readings (to help input current month)
     */
    async getReadingsForm(req, res, next) {
        try {
            const { building_id, month, year } = req.query;
            
            // Service returns the list of rooms and their "Start" index
            const data = await UtilityService.getPreviousReadings(building_id, month, year);
            
            res.status(200).json({
                success: true,
                message: "Retrieved previous readings successfully",
                data: data
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/utility/readings
     * Bulk save electricity/water numbers for the month
     */
    async submitReadings(req, res, next) {
        try {
            const userId = req.user.user_id; // From Auth Middleware
            const result = await UtilityService.recordMonthlyReadings(userId, req.body);

            res.status(200).json({
                success: true,
                message: `Successfully recorded readings for ${result.processed} rooms.`,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new UtilityController();
