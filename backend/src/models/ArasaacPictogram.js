const mongoose = require('mongoose');

const ArasaacPictogramSchema = new mongoose.Schema({
  arasaacId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  label: {
    type: String,
    required: true
  },
  keywords: {
    type: [String],
    default: []
  },
  imageUrl: {
    type: String,
    required: true
  },
  categories: {
    type: [String],
    default: []
  },
  tags: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  lastSyncedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ArasaacPictogram', ArasaacPictogramSchema);
