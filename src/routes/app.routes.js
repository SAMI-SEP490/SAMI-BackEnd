// src/routes/app.routes.js
const express = require('express');
const router = express.Router();
const appController = require('../controllers/app.controller');

// GET /api/app/open?path=dashboard
// Public route, no authentication needed (safe to click from email)
router.get('/open', appController.openAppRedirect);

module.exports = router;
