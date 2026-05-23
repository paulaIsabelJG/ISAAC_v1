const mongoose = require('mongoose');

const pictogramSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true,
    enum: ['arasaac', 'custom']
  }
}, { _id: false });

const interactionSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['add', 'remove', 'restart']
  },
  pictogramId: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const phraseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  pictograms: {
    type: [pictogramSchema],
    default: []
  },
  interactions: {
    type: [interactionSchema],
    default: []
  },
  finalText: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Phrase', phraseSchema);
