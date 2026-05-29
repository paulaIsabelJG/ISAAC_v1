const mongoose = require('mongoose');

const boardFolderSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('BoardFolder', boardFolderSchema);
