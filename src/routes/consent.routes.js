const express = require('express');
const router = express.Router();
const consentController = require('../controllers/consent.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');


router.use(authenticate);

router.post('/accept', consentController.acceptConsent);
router.post('/revoke', consentController.revokeConsent);
router.get('/history/:userId', consentController.getHistory);
router.get('/check/:userId/:consentType', consentController.checkConsent);
router.get('/version/:consentType', consentController.getActiveVersion);
router.get('/versions', consentController.getAllVersions);
router.post('/version', consentController.createVersion,   requireRole(['owner', 'manager']));

module.exports = router;