const express = require('express');
const router = express.Router();
const { autocomplete } = require('../controllers/placesController');

// GET /api/places/autocomplete?q=...
router.get('/autocomplete', autocomplete);

module.exports = router;
