const User              = require('../models/User');
const predictionService = require('../services/aacPredictionService');

/** Verificación de autorización compartida por ambos endpoints. */
async function checkAuthorization(callerId, userId) {
  if (callerId === userId) return true;
  const [caller, target] = await Promise.all([
    User.findById(callerId).select('type centro').lean(),
    User.findById(userId).select('centro').lean(),
  ]);
  return !!(
    caller && target &&
    caller.type === 'teacher' &&
    String(caller.centro) === String(target.centro)
  );
}

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
      limit             = 8,
      currentPhrase     = [],
      currentBoardRole  = 'main',
      currentBoardShape = 'grid',
      locationContext   = 'general',
    } = req.body;

    if (!userId || !boardId) {
      return res.status(400).json({ error: 'userId y boardId son obligatorios' });
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50);

    if (!await checkAuthorization(callerId, userId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const predictions = await predictionService.getSuggestions({
      userId,
      boardId,
      limit:            safeLimit,
      currentPhrase,
      currentBoardRole,
      currentBoardShape,
      locationContext,
    });

    return res.json({ predictions });
  } catch (err) {
    console.error('[PredictorIA] Error en suggest:', err);
    return res.status(500).json({ error: 'Error interno del predictor IA' });
  }
};

/**
 * POST /api/aac-prediction/circular
 *
 * Devuelve hasta `limit` sugerencias ordenadas por probabilidad para una categoría
 * de un tablero circular predictivo. Candidatos limitados a los configurados por
 * el logopeda en esa categoría (no se busca fuera de ella).
 */
exports.suggestCircular = async (req, res) => {
  try {
    const callerId = req.userId;

    const {
      userId,
      boardId,
      categoryId,
      limit           = 8,
      currentPhrase   = [],
      locationContext = 'general',
    } = req.body;

    if (!userId || !boardId || !categoryId) {
      return res.status(400).json({ error: 'userId, boardId y categoryId son obligatorios' });
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50);

    if (!await checkAuthorization(callerId, userId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const suggestions = await predictionService.getCircularSuggestions({
      userId,
      boardId,
      categoryId,
      limit:          safeLimit,
      currentPhrase,
      locationContext,
    });

    return res.json({ suggestions });
  } catch (err) {
    console.error('[PredictorCircular] Error en suggestCircular:', err);
    return res.status(500).json({ error: 'Error interno del predictor circular' });
  }
};
