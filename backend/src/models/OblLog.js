const mongoose = require('mongoose');

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
  actions:              [String],
  // action fields
  action:               String,   // :home, :backspace, :clear, :speak, :open_board
  destination_board_id: String,
  // utterance fields
  text:                 String,
  buttons:              [String],
}, { _id: false });

const oblLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  source:    { type: String, default: 'ISAAC' },
  format:    { type: String, default: 'open-board-log-0.1' },
  started:   { type: String },   // ISO
  ended:     { type: String },   // ISO
  events:    [oblEventSchema],
}, { timestamps: true });

oblLogSchema.index({ userId: 1, started: -1 });

module.exports = mongoose.model('OblLog', oblLogSchema);
