'use strict';
const Question     = require('../../models/Question');
const CacheService = require('../../services/cache.service');
const { validate } = require('../../middleware/validate.middleware');
const logger       = require('../../config/logger');

class QuestionService {
  static async create(data, createdBy) {
    // Duplicate check before insert
    const exists = await Question.findOne({
      category: data.category.trim(),
      text: { $regex: new RegExp(`^${data.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (exists) throw Object.assign(new Error('A question with this text already exists in this category'), { status: 409 });

    const question = await Question.create({ ...data, createdBy });
    await CacheService.invalidateQuestions(data.category);
    return question;
  }

  static async getById(id) {
    const q = await Question.findById(id).lean();
    if (!q) throw Object.assign(new Error('Question not found'), { status: 404 });
    return q;
  }

  static async list({ category, value, difficulty, search, page = 1, limit = 50, isActive } = {}) {
    const filter = {};
    if (category)   filter.category   = category;
    if (value)      filter.value      = +value;
    if (difficulty) filter.difficulty = difficulty;
    if (isActive !== undefined) filter.isActive = isActive === 'true' || isActive === true;
    if (search) filter.$or = [
      { text:   { $regex: search, $options: 'i' } },
      { answer: { $regex: search, $options: 'i' } },
    ];

    const p = Math.max(1, +page);
    const l = Math.min(100, Math.max(1, +limit));
    const skip = (p - 1) * l;

    const [questions, total] = await Promise.all([
      Question.find(filter).sort({ category: 1, value: 1 }).skip(skip).limit(l).lean(),
      Question.countDocuments(filter),
    ]);
    return { questions, total, page: p, limit: l };
  }

  static async listCategories() {
    const cats = await Question.distinct('category', { isActive: true });
    return cats.sort();
  }

  static async update(id, data, userId) {
    const allowed = ['category','value','text','answer','hint','mediaUrl','timeLimit','difficulty','isActive'];
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
    if (filtered.category) filtered.category = filtered.category.trim();
    if (filtered.text)     filtered.text     = filtered.text.trim();
    if (filtered.answer)   filtered.answer   = filtered.answer.trim();

    const question = await Question.findByIdAndUpdate(id, filtered, { new: true, runValidators: true }).lean();
    if (!question) throw Object.assign(new Error('Question not found'), { status: 404 });

    // Invalidate both old and new category caches
    await CacheService.invalidateQuestions(question.category);
    if (data.category && data.category !== question.category) {
      await CacheService.invalidateQuestions(data.category);
    }
    return question;
  }

  static async delete(id) {
    const question = await Question.findByIdAndDelete(id).lean();
    if (!question) throw Object.assign(new Error('Question not found'), { status: 404 });
    await CacheService.invalidateQuestions(question.category);
  }

  static async bulkImport(questions, createdBy) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw Object.assign(new Error('questions must be a non-empty array'), { status: 400 });
    }
    if (questions.length > 500) {
      throw Object.assign(new Error('Maximum 500 questions per bulk import'), { status: 400 });
    }

    const docs = questions.map((q) => ({ ...q, createdBy, isActive: true }));
    // ordered:false continues on duplicate errors
    const result = await Question.insertMany(docs, { ordered: false }).catch((err) => {
      if (err.code === 11000) {
        // Partial success — return what was inserted
        return err.insertedDocs || [];
      }
      throw err;
    });

    const cats = [...new Set(questions.map((q) => q.category).filter(Boolean))];
    await Promise.all(cats.map((c) => CacheService.invalidateQuestions(c)));
    logger.info('Bulk import complete', { count: Array.isArray(result) ? result.length : 0, by: createdBy });
    return Array.isArray(result) ? result : [];
  }
}

// ─── Controller ───────────────────────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const asyncHandler = require('../../middleware/asyncHandler');

router.use(authenticate);

router.post('/', requireRole('admin'), validate('createQuestion'), asyncHandler(async (req, res) => {
  const question = await QuestionService.create(req.body, req.user._id);
  res.status(201).json({ success: true, question });
}));

router.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ success: false, error: 'questions must be an array' });
  }
  const result = await QuestionService.bulkImport(questions, req.user._id);
  res.status(201).json({ success: true, count: result.length, imported: result });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await QuestionService.listCategories();
  res.json({ success: true, categories });
}));

router.get('/', asyncHandler(async (req, res) => {
  const result = await QuestionService.list(req.query);
  res.json({ success: true, ...result });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const question = await QuestionService.getById(req.params.id);
  res.json({ success: true, question });
}));

router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const question = await QuestionService.update(req.params.id, req.body, req.user._id);
  res.json({ success: true, question });
}));

router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await QuestionService.delete(req.params.id);
  res.json({ success: true });
}));

module.exports = { router, QuestionService };
