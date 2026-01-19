// src/middlewares/utility.middleware.js
// Created: 2026-01-20

const { z } = require('zod');
const { validate } = require('./validation.middleware');

// Schema for Getting Previous Readings (Query Params)
// GET /api/utility/readings?building_id=1&month=12&year=2025
const getReadingsSchema = z.object({
    building_id: z.preprocess((val) => parseInt(val), z.number().positive()),
    month: z.preprocess((val) => parseInt(val), z.number().min(1).max(12)),
    year: z.preprocess((val) => parseInt(val), z.number().int().min(2000).max(2100))
});

// Schema for Recording/Updating Readings (Body)
// POST /api/utility/readings
const recordReadingsSchema = z.object({
    building_id: z.number().positive(),
    billing_month: z.number().min(1).max(12),
    billing_year: z.number().int().min(2000).max(2100),
    readings: z.array(
        z.object({
            room_id: z.number().positive(),
            
            new_electric: z.number().nonnegative({ message: "Chỉ số điện không được âm" }),
            new_water: z.number().nonnegative({ message: "Chỉ số nước không được âm" }),
            
            // Overrides & Flags
            old_electric_override: z.number().nonnegative().optional(),
            old_water_override: z.number().nonnegative().optional(),
            
            is_electric_reset: z.boolean().optional().default(false),
            is_water_reset: z.boolean().optional().default(false)
        })
    ).min(1, { message: "Danh sách nhập liệu không được trống" })
    .superRefine((items, ctx) => {
        // Validate Unique Rooms
        const roomIds = items.map(i => i.room_id);
        const uniqueRooms = new Set(roomIds);
        if (uniqueRooms.size !== roomIds.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Duplicate room_id found in the list."
            });
        }
    })
});

module.exports = {
    validateGetReadings: (req, res, next) => {
        // Validate req.query for GET requests
        try {
            req.query = getReadingsSchema.parse(req.query);
            next();
        } catch (err) {
            return res.status(400).json({ success: false, message: err.errors?.[0]?.message || 'Invalid query params' });
        }
    },
    validateRecordReadings: validate(recordReadingsSchema)
};
