const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'student'], default: 'student' },
  isProfileComplete: { type: Boolean, default: false },
  name: { type: String },
  dob: { type: String },
  fatherName: { type: String },
  studentClass: { type: Number, min: 6, max: 12 }, 
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  medium: { type: String, enum: ['Hindi', 'English'] },
  schoolName: { type: String }
});

module.exports = mongoose.model('User', userSchema);