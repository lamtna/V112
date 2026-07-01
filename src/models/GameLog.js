const mongoose = require('mongoose');

const gameLogSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
  eventId:   { type: String, required: true, unique: true },
  sequence:  { type: Number, required: true },
  action:    { type: String, required: true },
  actorId:   { type: String },
  actorRole: { type: String },
  payload:   { type: mongoose.Schema.Types.Mixed },
  stateBefore: { type: String },
  stateAfter:  { type: String },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

gameLogSchema.index({ sessionId: 1, sequence: 1 });

module.exports = mongoose.model('GameLog', gameLogSchema);
