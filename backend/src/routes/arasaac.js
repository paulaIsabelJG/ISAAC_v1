const express = require('express');
const arasaacController = require('../controllers/arasaacController');

const router = express.Router();

router.get('/search',        arasaacController.search);
router.get('/local/:id',    arasaacController.getLocalPictogram);
router.get('/pictogram/:id', arasaacController.getPictogram);

module.exports = router;
