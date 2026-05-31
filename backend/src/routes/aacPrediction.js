const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/authMiddleware');
const ctrl    = require('../controllers/aacPredictionController');

router.use(auth);

// POST /api/aac-prediction/suggest
router.post('/suggest', ctrl.suggest);

module.exports = router;
