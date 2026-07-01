const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
  sessionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
  version:      { type: Number, required: true },
  state:        { type: String, required: true },
  fullGameState: { type: mongoose.Schema.Types.Mixed, required: true },
  logSequence:  { type: Number, required: true },
  createdAt:    { type: Date, default: Date.now },
}, { timestamps: false });

snapshotSchema.index({ sessionId: 1, version: -1 });

module.exports = mongoose.model('Snapshot', snapshotSchema);
