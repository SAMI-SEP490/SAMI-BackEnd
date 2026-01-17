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
// 1. Xem chi tiết version (Draft hoặc Active cũ)
router.get('/version/detail/:versionId',
    requireRole(['owner']),
    consentController.getVersionDetail
);

// 2. Tạo bản nháp mới (Draft)
router.post('/version/draft',
    requireRole(['owner']),
    consentController.draftVersion
);

// 3. Sửa bản nháp (Update Draft)
router.put('/version/:versionId',
    requireRole(['owner']),
    consentController.updateVersion
);

// 4. Công bố bản nháp (Publish)
router.post('/version/:versionId/publish',
    requireRole(['owner']),
    consentController.publishVersion
);
router.get('/pending', consentController.checkPending);
module.exports = router;