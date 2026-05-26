const mongoose = require('mongoose');

// ── Subdocumento: pictograma de celda ──────────────────────────────────────────
const pictogramSchema = new mongoose.Schema({
  source:            { type: String, enum: ['arasaac', 'custom', 'new'], default: 'new' },
  id:                { type: String, default: '' },
  label:             { type: String, required: true },
  imageUrl:          { type: String, default: '' },
  sound:             { type: String, default: '' },
  tags:              [{ type: String }],
  description:       { type: String, default: '' },
  wordType:          { type: String, default: 'misc' },   // verb|pronoun|noun|descriptor|social|misc
  fitzgeraldEnabled: { type: Boolean, default: true },
  color:             { type: String, default: '#f5f5f5' },
}, { _id: false });

// ── Subdocumento: acción de celda ──────────────────────────────────────────────
const actionSchema = new mongoose.Schema({
  type:                  { type: String, enum: ['voice', 'navigate', 'voice+navigate', 'disabled'], default: 'voice' },
  targetBoardId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Board', default: null },
  aiGeneratedBoardTarget:{ type: Boolean, default: false },
  showLastPhrase:        { type: Boolean, default: false },
}, { _id: false });

// ── Subdocumento: celda ────────────────────────────────────────────────────────
const cellSchema = new mongoose.Schema({
  row:       { type: Number, required: true },
  col:       { type: Number, required: true },
  pictogram: { type: pictogramSchema, default: null },
  action:    { type: actionSchema,    default: () => ({ type: 'voice', targetBoardId: null }) },
}, { _id: false });

// ── Esquema principal ──────────────────────────────────────────────────────────
const boardSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  imageUrl:         { type: String, default: '' },
  // creatorId: campo legacy. Sustituido por createdBy (más explícito).
  // Mantener para compatibilidad con datos antiguos.
  creatorId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // createdBy: quién creó/importó el tablero (contexto de builder, NUNCA sobreescribible desde frontend)
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  // creatorName: nombre denormalizado del creador para mostrar en UI (se fija en createBoard)
  creatorName:      { type: String, default: '' },
  // userId: usuario final ASIGNADO al tablero (puede ser distinto del creador)
  // Mantenido como campo legacy/primer usuario para compatibilidad con código antiguo.
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // assignedUserIds: lista de usuarios a los que está asignado el tablero (1-N).
  // Si se envía desde frontend, userId se sincroniza con assignedUserIds[0].
  // Boards creados antes de este campo no tendrán este array → fallan hacia userId.
  assignedUserIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  shape:            { type: String, enum: ['grid', 'circular'], default: 'grid' },
  rows:             { type: Number, default: 3, min: 1, max: 10 },
  columns:          { type: Number, default: 4, min: 1, max: 10 },
  circleSlots:           { type: Number, default: 8,  min: 3, max: 20 },
  locationColumnEnabled: { type: Boolean, default: false },
  locationColumnSlots:   { type: Number, default: 6,  min: 1, max: 20 },
  predictorEnabled:      { type: Boolean, default: false },
  aiRewriteEnabled: { type: Boolean, default: false },
  iaRows:           { type: Number,  default: 5, min: 1, max: 20 },
  iaCols:           { type: Number,  default: 1, min: 1, max: 5  },
  // ── Rol y perfil ──────────────────────────────────────────────────────────────
  boardRole:          { type: String, enum: ['main', 'secondary'], default: 'main' },
  visibleInProfile:   { type: Boolean, default: false },
  profileName:        { type: String,  default: '' },
  profileImage:       { type: String,  default: '' },
  profileDescription: { type: String,  default: '' },
  cells:            [cellSchema],
  createdAt:        { type: Date, default: Date.now },
});

boardSchema.index({ creatorId: 1 });
boardSchema.index({ createdBy: 1 });
boardSchema.index({ userId: 1 });
boardSchema.index({ assignedUserIds: 1 });

module.exports = mongoose.model('Board', boardSchema);
