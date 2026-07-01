'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String, required: true, unique: true, trim: true,
    minlength: 2, maxlength: 30,
    match: [/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, underscores and hyphens'],
  },
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
  },
  password:  { type: String, required: true, select: false, minlength: 8 },
  role:      { type: String, enum: ['admin', 'host', 'player'], default: 'player' },
  isActive:  { type: Boolean, default: true },
  lastLogin: { type: Date },
}, { timestamps: true });

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ role: 1, isActive: 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
