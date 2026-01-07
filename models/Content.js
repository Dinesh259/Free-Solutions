const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  classLevel: { type: Number, required: true }, // 6-12
  medium: { type: String, required: true }, // Hindi/English
  subject: { type: String, required: true }, // Math/Science
  chapterName: { type: String, required: true },
  exercise: { type: String }, // Optional, primarily for Math
  questionNumber: { type: String, required: true },
  questionDescription: { type: String },
  videoID: { type: String, required: false }, // YouTube ID (e.g., dQw4w9WgXcQ)
  textSolution: { type: String }, // Can contain basic HTML
  questionImage: { type: String, required: false }
}, {
   timestamps:true
});

// Index for faster retrieval based on student profile
contentSchema.index({ classLevel: 1, medium: 1, subject: 1 });

module.exports = mongoose.model('Content', contentSchema);