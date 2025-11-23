// Updated: 2025-23-11
// by: MinhBH

const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

router.use(authenticate);

// POST /api/chatbot/chat
// Chat with the bot
router.post(
    '/chat',
    requireRole(['tenant']),
    chatbotController.chat
);

// ET /api/chatbot/opening
// Fetches the welcome message and initial buttons
router.get(
    '/opening',
    requireRole(['tenant']),
    chatbotController.getOpening
);

// GET /api/chatbot/suggested/:messageId
// Fetches follow-up questions for a specific answer
router.get(
    '/suggested/:messageId',
    requireRole(['tenant']),
    chatbotController.getSuggested
);

module.exports = router;
