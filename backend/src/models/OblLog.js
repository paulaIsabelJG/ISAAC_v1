const mongoose = require('mongoose');

// Acción OBL estructurada (open-board-log-0.1)
const oblActionSchema = new mongoose.Schema({
  action:                   { type: String, required: true },
  destination_board_id:     String,
  ext_isaac_slot_id:        Number,
  ext_isaac_multi_board_id: String,
}, { _id: false });

const oblEventSchema = new mongoose.Schema({
  id:                   { type: String, required: true },   // uuid
  type:                 { type: String, enum: ['button', 'action', 'utterance'], required: true },
  timestamp:            { type: String, required: true },   // ISO string
  // button fields
  label:                String,
  vocalization:         String,
  spoken:               Boolean,
  button_id:            String,
  board_id:             String,
  image_url:            String,
  actions:              [oblActionSchema],                  // array de OblAction estructurado
  // Fitzgerald color y categoría gramatical del pictograma (conservar para estadísticas)
  color:                String,
  wordType:             String,
  // action fields
  action:               String,   // :home, :backspace, :clear, :speak, :open_board
  destination_board_id: String,
  // utterance fields
  text:                 String,
  buttons:              { type: [mongoose.Schema.Types.Mixed], default: undefined },
  // extensión ISAAC: reformulación IA (action 'ext_isaac_ai_reformulation')
  ext_isaac_original_text:     String,
  ext_isaac_reformulated_text: String,
  ext_isaac_ai_tokens:         [mongoose.Schema.Types.Mixed],
  // identificador estable de frase (compartido por button, :speak, utterance y ai_reformulation)
  ext_isaac_phrase_id:         String,
  // contexto de ubicación semántico (solo eventos button). Nunca se guardan coordenadas.
  location_context:            String,
  location_id:                 String,
  location_name:               String,
}, { _id: false });

const oblLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  source:    { type: String, default: 'ISAAC' },
  format:    { type: String, default: 'open-board-log-0.1' },
  started:   { type: String },   // ISO
  ended:     { type: String },   // ISO
  events:           [oblEventSchema],
  deletedPhraseKeys: [{ type: String }],
}, { timestamps: true });

oblLogSchema.index({ userId: 1, started: -1 });

module.exports = mongoose.model('OblLog', oblLogSchema);
