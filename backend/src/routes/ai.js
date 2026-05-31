const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const aiController   = require('../controllers/aiController');

// POST /api/ai/reformulate-phrase
// Reformula una frase telegráfica AAC con IA.
// Requiere JWT válido: el usuario solo puede reformular frases de su propia sesión activa.
router.post('/reformulate-phrase', authMiddleware, aiController.reformulatePhrase);

module.exports = router;
