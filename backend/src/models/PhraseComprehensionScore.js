const mongoose = require('mongoose');

// Valoración de comprensión de una frase reconstruida (no persistente) del OBL.
// phraseKey = mismo identificador estable que usa phraseReconstructionService
// (sessionId + ext_isaac_phrase_id), NUNCA el texto de la frase.
const phraseComprehensionScoreSchema = new mongoose.Schema({
  phraseKey:                { type: String, required: true, unique: true },
  userId:                   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  comprehensionScore:       { type: Number, min: 1, max: 5, required: true },
  comprehensionEvaluatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  comprehensionEvaluatedAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('PhraseComprehensionScore', phraseComprehensionScoreSchema);
