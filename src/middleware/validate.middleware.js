'use strict';
const Joi = require('joi');

const VALID_STATES = ['lobby','playing','question','answer','scoring','finished'];

const schemas = {
  addTeam: Joi.object({
    name: Joi.string().trim().min(1).max(40).required()
      .messages({ 'string.empty': 'Team name cannot be empty', 'any.required': 'name is required' }),
  }),

  selectCategories: Joi.object({
    categories: Joi.array().items(Joi.string().trim().min(1)).length(6).unique().required()
      .messages({ 'array.length': 'Must select exactly 6 categories', 'array.unique': 'Categories must be distinct' }),
  }),

  transition: Joi.object({
    targetState: Joi.string().valid(...VALID_STATES).required(),
  }),

  selectQuestion: Joi.object({
    category: Joi.string().trim().min(1).required(),
    value:    Joi.number().valid(200, 400, 600, 800).required(),
  }),

  assignScore: Joi.object({
    teamId:  Joi.string().uuid().required(),
    correct: Joi.boolean().required(),
  }),

  createQuestion: Joi.object({
    category:   Joi.string().trim().min(1).max(60).required(),
    value:      Joi.number().valid(200, 400, 600, 800).required(),
    text:       Joi.string().trim().min(5).max(500).required(),
    answer:     Joi.string().trim().min(1).max(300).required(),
    hint:       Joi.string().trim().max(200).allow('', null),
    mediaUrl:   Joi.string().uri().allow('', null),
    timeLimit:  Joi.number().integer().min(10).max(120).default(30),
    difficulty: Joi.string().valid('easy','medium','hard').default('medium'),
  }),
};

/**
 * validate(schemaName) — middleware that validates req.body against Joi schema.
 * Returns 400 on failure; calls next() on success.
 */
function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }
    req.body = value; // replace with sanitized/coerced value
    next();
  };
}

module.exports = { validate, schemas };
