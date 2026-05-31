const User              = require('../models/User');
const predictionService = require('../services/aacPredictionService');

/**
 * POST /api/aac-prediction/suggest
 *
 * Devuelve pictogramas ordenados por probabilidad de uso para un usuario y
 * contexto de frase dados. Solo accesible para el propio usuario o para un
 * teacher/profesional del mismo centro.
 */
exports.suggest = async (req, res) => {
  try {
    const callerId = req.userId; // del JWT

    const {
      userId,
      boardId,
      limit        = 8,
      currentPhrase  = [],
      currentBoardRole  = 'main',
      currentBoardShape = 'grid',
    } = req.body;

    if (!userId || !boardId) {
      return res.status(400).json({ error: 'userId y boardId son obligatorios' });
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50);

    // ── Verificación de autorización ──────────────────────────────────────────
    // Permitido si el llamante ES el usuario final, o si es teacher del mismo centro.
    if (callerId !== userId) {
      const [caller, target] = await Promise.all([
        User.findById(callerId).select('type centro').lean(),
        User.findById(userId).select('centro').lean(),
      ]);
      if (
        !caller ||
        !target ||
        caller.type !== 'teacher' ||
        String(caller.centro) !== String(target.centro)
      ) {
        return res.status(403).json({ error: 'No autorizado' });
      }
    }

    const predictions = await predictionService.getSuggestions({
      userId,
      boardId,
      limit:            safeLimit,
      currentPhrase,
      currentBoardRole,
      currentBoardShape,
    });

    return res.json({ predictions });
  } catch (err) {
    console.error('[PredictorIA] Error en suggest:', err);
    return res.status(500).json({ error: 'Error interno del predictor IA' });
  }
};
