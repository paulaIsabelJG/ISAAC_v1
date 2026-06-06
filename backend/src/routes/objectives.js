const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/objectiveController');
const auth    = require('../middleware/authMiddleware');

router.use(auth);

// Orden importante: rutas estáticas ANTES de /:id
router.post   ('/',                              ctrl.createObjective);
router.get    ('/',                              ctrl.getObjectives);
router.get    ('/family',                        ctrl.getFamilyObjectives);     // antes de /:id
router.get    ('/user/:userId',                  ctrl.getUserObjectives);       // antes de /:id
router.get    ('/:id',                           ctrl.getObjectiveById);
router.put    ('/:id',                           ctrl.updateObjective);
router.patch  ('/:id/status',                    ctrl.updateObjectiveStatus);

// ── Comentarios ────────────────────────────────────────────────────────────────
router.get    ('/:id/comments',                  ctrl.getObjectiveComments);
router.post   ('/:id/comments',                  ctrl.addObjectiveComment);
router.put    ('/:id/comments/:commentId',       ctrl.updateObjectiveComment);
router.delete ('/:id/comments/:commentId',       ctrl.deleteObjectiveComment);

module.exports = router;
