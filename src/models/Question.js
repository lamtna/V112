'use strict';
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  category:   { type: String, required: true, trim: true, index: true },
  value:      { type: Number, enum: [200, 400, 600, 800], required: true },
  text:       { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
  answer:     { type: String, required: true, trim: true, maxlength: 300 },
  hint:       { type: String, trim: true, maxlength: 200 },
  mediaUrl:   { type: String, trim: true },
  timeLimit:  { type: Number, default: 30, min: 10, max: 120 },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  isActive:   { type: Boolean, default: true, index: true },
  usageCount: { type: Number, default: 0, min: 0 },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

questionSchema.index({ category: 1, value: 1, isActive: 1 });
questionSchema.index({ createdBy: 1 });

// Prevent duplicate questions (same text in same category)
questionSchema.index({ category: 1, text: 1 }, { unique: true });

module.exports = mongoose.model('Question', questionSchema);
