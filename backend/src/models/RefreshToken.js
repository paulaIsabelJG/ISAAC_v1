const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },     // SHA-256 del token en bruto
  deviceId:  { type: String, default: '' },
  expiresAt: { type: Date,   required: true },
  revokedAt: { type: Date,   default: null },
}, { timestamps: true });

refreshTokenSchema.index({ userId:    1 });
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
// TTL index: MongoDB borra automáticamente los documentos cuando expiresAt pasa
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
