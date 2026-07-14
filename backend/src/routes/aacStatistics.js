const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/aacStatisticsController');
const auth    = require('../middleware/authMiddleware');

router.use(auth);

// ── Organización ──────────────────────────────────────────────────────────────
router.get('/organization/summary', ctrl.getOrganizationSummary);
router.get('/organization/by-role', ctrl.getStatsByUserType);
router.get('/organization/charts',  ctrl.getOrganizationCharts);
router.get('/organization/boards',  ctrl.getOrganizationBoards);
router.get('/organization/phrases', ctrl.getOrganizationPhrases);

// ── Exportación ───────────────────────────────────────────────────────────────
router.post('/export/obla', ctrl.exportObla);

// ── Borrar frase ──────────────────────────────────────────────────────────────
router.delete('/phrases/:phraseId', ctrl.deletePhrase);

// ── Valoración de comprensión ─────────────────────────────────────────────────
router.patch('/phrases/:phraseId/comprehension', ctrl.setPhraseComprehension);

// ── Usuario concreto ──────────────────────────────────────────────────────────
router.get('/users/:userId/summary', ctrl.getUserStatistics);
router.get('/users/:userId/phrases', ctrl.getUserPhrases);

module.exports = router;
