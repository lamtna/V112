#!/usr/bin/env node
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('../src/models/User');
const Question = require('../src/models/Question');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/quizgame';

const SEED_QUESTIONS = [
  // Science — 4 values each
  { category:'Science', value:200, text:'What is the chemical symbol for water?',             answer:'H₂O',              difficulty:'easy',   timeLimit:20 },
  { category:'Science', value:400, text:'What planet is known as the Red Planet?',            answer:'Mars',             difficulty:'easy',   timeLimit:25 },
  { category:'Science', value:600, text:'What is the powerhouse of the cell?',                answer:'Mitochondria',     difficulty:'medium', timeLimit:30, hint:'It produces ATP' },
  { category:'Science', value:800, text:'What is the approximate speed of light in km/s?',   answer:'299,792 km/s',     difficulty:'hard',   timeLimit:35, hint:'About 3 × 10⁸ m/s' },

  // History
  { category:'History', value:200, text:'In what year did World War II end?',                  answer:'1945',             difficulty:'easy',   timeLimit:20 },
  { category:'History', value:400, text:'Who was the first US President?',                     answer:'George Washington',difficulty:'easy',   timeLimit:20 },
  { category:'History', value:600, text:'Which empire did Julius Caesar lead?',                answer:'Roman Empire',     difficulty:'medium', timeLimit:25 },
  { category:'History', value:800, text:'In what year did the Ottoman Empire officially dissolve?', answer:'1922',        difficulty:'hard',   timeLimit:30, hint:'After World War I' },

  // Sports
  { category:'Sports',  value:200, text:'How many players are on a basketball team on court?',answer:'5',                difficulty:'easy',   timeLimit:15 },
  { category:'Sports',  value:400, text:'Which country invented the Olympic Games?',           answer:'Greece',           difficulty:'easy',   timeLimit:20 },
  { category:'Sports',  value:600, text:'How many holes are in a standard round of golf?',    answer:'18',               difficulty:'medium', timeLimit:20 },
  { category:'Sports',  value:800, text:'Which country has won the most FIFA World Cups?',    answer:'Brazil (5 titles)', difficulty:'hard',  timeLimit:30, hint:'South American nation' },

  // Movies
  { category:'Movies',  value:200, text:'Who directed the 1993 film Jurassic Park?',          answer:'Steven Spielberg', difficulty:'easy',   timeLimit:25 },
  { category:'Movies',  value:400, text:'In which 1994 film does Forrest Gump run across America?', answer:'Forrest Gump', difficulty:'easy', timeLimit:20 },
  { category:'Movies',  value:600, text:'Which film won the first ever Academy Award for Best Picture?', answer:'Wings (1927)', difficulty:'hard', timeLimit:35, hint:'Silent era film' },
  { category:'Movies',  value:800, text:'Name the director of 2001: A Space Odyssey.',        answer:'Stanley Kubrick',  difficulty:'hard',   timeLimit:30 },

  // Music
  { category:'Music',   value:200, text:'How many strings does a standard guitar have?',      answer:'6',                difficulty:'easy',   timeLimit:15 },
  { category:'Music',   value:400, text:'Which band released Bohemian Rhapsody in 1975?',     answer:'Queen',            difficulty:'easy',   timeLimit:20 },
  { category:'Music',   value:600, text:'What is the fastest standard classical tempo marking?', answer:'Prestissimo',   difficulty:'hard',   timeLimit:30, hint:'Faster than presto' },
  { category:'Music',   value:800, text:'Who composed The Four Seasons (Le quattro stagioni)?', answer:'Antonio Vivaldi', difficulty:'medium', timeLimit:30 },

  // Technology
  { category:'Technology', value:200, text:'What does CPU stand for?',                        answer:'Central Processing Unit', difficulty:'easy', timeLimit:20 },
  { category:'Technology', value:400, text:'Who co-founded Apple with Steve Wozniak?',        answer:'Steve Jobs',       difficulty:'easy',   timeLimit:20 },
  { category:'Technology', value:600, text:'What programming language is the Linux kernel primarily written in?', answer:'C', difficulty:'medium', timeLimit:25 },
  { category:'Technology', value:800, text:'In what year did Tim Berners-Lee invent the World Wide Web?', answer:'1989', difficulty:'medium', timeLimit:30, hint:'At CERN' },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB:', MONGO_URI);

  // ── Users ──
  const existing = await User.findOne({ email: 'admin@quiz.com' });
  if (existing) {
    console.log('ℹ  Admin user already exists — skipping user seed');
  } else {
    await User.create([
      { username:'admin', email:'admin@quiz.com', password:'admin123!', role:'admin' },
      { username:'host',  email:'host@quiz.com',  password:'host123!',  role:'host'  },
      { username:'player1', email:'player@quiz.com', password:'player123!', role:'player' },
    ]);
    console.log('✓ Users created');
    console.log('  admin@quiz.com  / admin123!');
    console.log('  host@quiz.com   / host123!');
    console.log('  player@quiz.com / player123!');
  }

  const admin = await User.findOne({ email: 'admin@quiz.com' });

  // ── Questions ──
  const existingCount = await Question.countDocuments();
  if (existingCount > 0) {
    console.log(`ℹ  ${existingCount} questions already exist — skipping question seed`);
    console.log('  Run with --force to reseed: node scripts/seed.js --force');
  } else {
    const docs = SEED_QUESTIONS.map((q) => ({ ...q, isActive:true, createdBy: admin._id }));
    await Question.insertMany(docs);
    console.log(`✓ ${docs.length} questions seeded across 6 categories`);
  }

  // ── Force reseed ──
  if (process.argv.includes('--force')) {
    const cats = [...new Set(SEED_QUESTIONS.map((q) => q.category))];
    await Question.deleteMany({ category: { $in: cats } });
    const docs = SEED_QUESTIONS.map((q) => ({ ...q, isActive:true, createdBy: admin._id }));
    await Question.insertMany(docs);
    console.log(`✓ Force-reseeded ${docs.length} questions`);
  }

  await mongoose.disconnect();
  console.log('✓ Seed complete!');
}

seed().catch((err) => {
  console.error('✗ Seed failed:', err.message);
  process.exit(1);
});
