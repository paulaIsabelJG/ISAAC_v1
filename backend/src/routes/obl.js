const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/oblController');
const auth       = require('../middleware/authMiddleware');

router.use(auth);

router.post  ('/',                      ctrl.startSession);
router.post  ('/:sessionId/events',     ctrl.appendEvents);
router.patch ('/:sessionId/end',        ctrl.endSession);
router.get   ('/user/:userId',          ctrl.getSessionsByUser);

module.exports = router;
