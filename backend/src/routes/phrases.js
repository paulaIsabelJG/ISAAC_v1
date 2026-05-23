const express = require('express');
const phraseController = require('../controllers/phraseController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/', phraseController.createPhrase);
router.get('/', phraseController.getPhrases);
router.get('/user/:userId', phraseController.getPhrasesByUserId);
router.get('/:id', phraseController.getPhraseById);

module.exports = router;
