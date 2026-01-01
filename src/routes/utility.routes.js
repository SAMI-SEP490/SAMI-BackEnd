// src/routes/utility.routes.js
// Updated: 2026-01-01

const express = require("express");
const router = express.Router();

const utilityController = require("../controllers/utility.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");
const {
  validateGetReadings,
  validateRecordReadings,
} = require("../middlewares/utility.middleware");

// ---------------- GLOBAL MIDDLEWARE ----------------
router.use(authenticate);
router.use(requireRole(["MANAGER", "OWNER"])); // Only management can access utilities

// ---------------- ROUTES ----------------

/**
 * 1️⃣ Get previous month readings (for input form)
 * GET /api/utility/readings?building_id=1&month=5&year=2025
 */
router.get("/readings", validateGetReadings, utilityController.getReadingsForm);

/**
 * 2️⃣ Submit monthly readings (bulk upsert)
 * POST /api/utility/readings
 */
router.post(
  "/readings",
  validateRecordReadings,
  utilityController.submitReadings
);

/**
 * 3️⃣ Get ALL previous readings (history)
 * GET /api/utility/readings/history?building_id=1&month=5&year=2025
 */
router.get(
  "/readings/history",
  validateGetReadings, // reuse same validator
  utilityController.getAllPreviousReadings
);

module.exports = router;
