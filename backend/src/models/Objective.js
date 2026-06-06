const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  text:         { type: String, required: true, trim: true, maxlength: 1000 },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // El hilo al que pertenece este comentario: siempre es un usuario final concreto
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const objectiveSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },

  // Usuarios finales asignados
  assignedUserIds:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Familiares que deben ver el objetivo (solo si showToFamily=true)
  familyRecipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },

  // 'expired' no se almacena; se calcula: status='active' && endDate < now
  status: {
    type:    String,
    enum:    ['active', 'completed', 'cancelled'],
    default: 'active',
  },

  showToFinalUser: { type: Boolean, default: false },
  showToFamily:    { type: Boolean, default: false },

  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByRole: { type: String, enum: ['organization', 'professional'], required: true },

  // Centro al que pertenece el objetivo (para aislamiento multi-organización)
  centro: { type: String },

  comments: [commentSchema],

}, { timestamps: true });

objectiveSchema.index({ createdBy: 1, createdAt: -1 });
objectiveSchema.index({ assignedUserIds: 1 });
objectiveSchema.index({ familyRecipientIds: 1 });
objectiveSchema.index({ centro: 1, createdAt: -1 });

module.exports = mongoose.model('Objective', objectiveSchema);
