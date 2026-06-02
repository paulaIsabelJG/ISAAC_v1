const mongoose = require('mongoose');

const ttsAudioCacheSchema = new mongoose.Schema({
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  textHash:            { type: String, required: true },
  text:                { type: String, required: true },
  voiceMode:           { type: String, enum: ['catalog', 'custom'], required: true },
  voiceProvider:       { type: String, default: 'openvoice' },
  voiceProfileVersion: { type: Number, default: 1 },
  audioPath:           { type: String, required: true },
  createdAt:           { type: Date, default: Date.now },
  lastUsedAt:          { type: Date, default: Date.now },
});

ttsAudioCacheSchema.index({ userId: 1, textHash: 1, voiceMode: 1 }, { unique: true });

module.exports = mongoose.model('TtsAudioCache', ttsAudioCacheSchema);
