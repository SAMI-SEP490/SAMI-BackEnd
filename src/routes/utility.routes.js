// src/routes/utility.routes.js
// Created: 2026-01-01

const express = require('express');
const router = express.Router();
const utilityController = require('../controllers/utility.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { validateGetReadings, validateRecordReadings } = require('../middlewares/utility.middleware');

// Global Middleware for this router
router.use(authenticate);
router.use(requireRole(['MANAGER', 'OWNER'])); // Only management can input utilities

// --- ROUTES ---

// 1. Get data to fill the UI form (Old Index)
// Usage: GET /api/utility/readings?building_id=1&month=5&year=2025
router.get('/readings', validateGetReadings, utilityController.getReadingsForm);

// 2. Submit the form (New Index)
// Usage: POST /api/utility/readings
router.post('/readings', validateRecordReadings, utilityController.submitReadings);

module.exports = router;
