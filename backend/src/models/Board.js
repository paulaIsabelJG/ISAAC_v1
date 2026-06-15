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
  type: {
    type: String,
    enum: ['voice', 'navigate', 'voice+navigate', 'disabled', 'setSlot', 'voice+setSlot', 'speakAndBack'],
    default: 'voice'
  },
  targetBoardId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Board', default: null },
  aiGeneratedBoardTarget:{ type: Boolean, default: false },
  showLastPhrase:        { type: Boolean, default: false },
  // Para acciones setSlot / voice+setSlot: hueco destino en el multitablero
  targetSlotId:          { type: Number, default: null },
}, { _id: false });

// ── Subdocumento: celda ────────────────────────────────────────────────────────
const cellSchema = new mongoose.Schema({
  row:       { type: Number, required: true },
  col:       { type: Number, required: true },
  pictogram: { type: pictogramSchema, default: null },
  action:    { type: actionSchema,    default: () => ({ type: 'voice', targetBoardId: null }) },
}, { _id: false });

// ── Subdocumento: icono de categoría predictiva ────────────────────────────────
const predictiveIconSchema = new mongoose.Schema({
  label:     { type: String, default: '' },
  imageUrl:  { type: String, default: '' },
  arasaacId: { type: String, default: '' },
  wordType:  { type: String, default: '' },
}, { _id: false });

// ── Subdocumento: pictograma candidato manual ──────────────────────────────────
const predictivePictogramSchema = new mongoose.Schema({
  label:             { type: String,  default: '' },
  sound:             { type: String,  default: '' },
  imageUrl:          { type: String,  default: '' },
  arasaacId:         { type: String,  default: '' },
  wordType:          { type: String,  default: 'misc' },
  color:             { type: String,  default: '' },
  fitzgeraldEnabled: { type: Boolean, default: true },
  action:            { type: mongoose.Schema.Types.Mixed, default: () => ({ type: 'voice' }) },
}, { _id: false });

// ── Subdocumento: categoría predictiva circular ────────────────────────────────
const predictiveCategorySchema = new mongoose.Schema({
  id:               { type: String, required: true },
  label:            { type: String, default: '' },
  icon:             { type: predictiveIconSchema, default: () => ({}) },
  color:            { type: String, default: '#9c27b0' },
  sourceType:       { type: String, enum: ['board', 'manual'], default: 'manual' },
  sourceBoardId:    { type: String, default: null },
  manualPictograms: [predictivePictogramSchema],
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
  // No required: los tableros secundarios no enlazados pueden no tener usuario todavía.
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  // assignedUserIds: lista de usuarios a los que está asignado el tablero (1-N).
  // Si se envía desde frontend, userId se sincroniza con assignedUserIds[0].
  // Boards creados antes de este campo no tendrán este array → fallan hacia userId.
  assignedUserIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  shape:            { type: String, enum: ['grid', 'circular', 'multi'], default: 'grid' },
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
  // boardRole: 'main' | 'secondary' son los roles actuales. 'multi' se mantiene
  // solo para compatibilidad con datos creados antes de introducir shape='multi'.
  boardRole:          { type: String, enum: ['main', 'secondary', 'multi'], default: 'main' },
  // Campos exclusivos del multitablero (shape === 'multi' o boardRole === 'multi' legacy)
  slotCount:          { type: Number, enum: [2, 3, 4] },
  multiBoardSlots:    [{
    slotId:  { type: Number, required: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', default: null },
    _id: false
  }],
  // Posición visual de la columna IA en el editor/comunicador del multitablero
  multiBoardIaPosition: { type: String, enum: ['left', 'right', 'between-1-2', 'between-2-3'], default: 'left' },
  // Proporciones de los huecos (widths = anchos %, heights = altos % para 4-huecos)
  multiBoardLayout: {
    widths:  { type: [Number], default: [] },
    heights: { type: [Number], default: [] },
    _id: false
  },
  // Configuración de la barra AAC (definida en tableros principales, heredada en runtime)
  controlsConfig: {
    visibleButtons: { type: [String], default: ['home','back','speak','deleteLast','clearAll'] },
    order:          { type: [String], default: ['home','back','speak','phraseBar','deleteLast','clearAll'] },
    _id: false,
  },
  autoPersonalize:    { type: Boolean, default: false },
  // ── Configuración de barras circulares (topBar + rightBar) ───────────────────
  circularControlsConfig: {
    topBar:         { type: [String], default: ['home', 'phraseBar'] },
    rightBar:       { type: [String], default: ['back', 'speak', 'deleteLast', 'clearAll'] },
    visibleButtons: { type: [String], default: ['home', 'back', 'speak', 'deleteLast', 'clearAll'] },
    _id: false,
  },
  // ── Tablero circular predictivo inteligente ───────────────────────────────────
  isPredictiveCircular:    { type: Boolean, default: false },
  predictiveCircularConfig: {
    suggestionsPerCategory: { type: Number, default: 8 },
    categories:             [predictiveCategorySchema],
    _id: false,
  },
  visibleInProfile:   { type: Boolean, default: false },
  profileName:        { type: String,  default: '' },
  profileImage:       { type: String,  default: '' },
  profileDescription: { type: String,  default: '' },
  cells:            [cellSchema],
  folderId:         { type: mongoose.Schema.Types.ObjectId, ref: 'BoardFolder', default: null },
  isFavorite:       { type: Boolean, default: false },
}, { timestamps: true });

boardSchema.index({ creatorId: 1 });
boardSchema.index({ createdBy: 1 });
boardSchema.index({ userId: 1 });
boardSchema.index({ assignedUserIds: 1 });

module.exports = mongoose.model('Board', boardSchema);
