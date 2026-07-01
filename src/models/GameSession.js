'use strict';
const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  id:      { type: String, required: true },
  name:    { type: String, required: true, trim: true, maxlength: 40 },
  score:   { type: Number, default: 0 },
  players: [{ type: String }],
  color:   { type: String, default: '#6366f1' },
}, { _id: false });

const boardValueSchema = new mongoose.Schema({
  value:      { type: Number, enum: [200, 400, 600, 800], required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  used:       { type: Boolean, default: false },
}, { _id: false });

const questionBoardSchema = new mongoose.Schema({
  category: { type: String, required: true, trim: true },
  values:   [boardValueSchema],
}, { _id: false });

const gameSessionSchema = new mongoose.Schema({
  code:     { type: String, required: true, unique: true, uppercase: true, trim: true, minlength: 6, maxlength: 6 },
  hostId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  state:    {
    type: String,
    enum: ['setup', 'lobby', 'playing', 'question', 'answer', 'scoring', 'finished'],
    default: 'setup',
  },
  version:  { type: Number, default: 0, min: 0 },
  teams:    { type: [teamSchema], default: [] },
  categories: [{ type: String, trim: true }],
  board:    { type: [questionBoardSchema], default: [] },
  currentQuestion: {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
    category:   { type: String },
    value:      { type: Number },
    startedAt:  { type: Date },
    timeLimit:  { type: Number, default: 30 },
  },
  locked:   { type: Boolean, default: false },
  settings: {
    maxTeams:  { type: Number, default: 6, min: 2, max: 10 },
    timeLimit: { type: Number, default: 30, min: 10, max: 120 },
  },
  expiresAt:   { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  finishedAt:  { type: Date },
  abandonedAt: { type: Date },
}, { timestamps: true });

// Indexes
gameSessionSchema.index({ hostId: 1, createdAt: -1 });
gameSessionSchema.index({ state: 1 });
gameSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index — auto-delete after 24h

module.exports = mongoose.model('GameSession', gameSessionSchema);
