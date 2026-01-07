const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect('mongodb://127.0.0.1:27017/freeSolutions')
.then(async () => {
    const hashedPassword = await bcrypt.hash('student123', 10);
    
    try {
        await User.create({
            mobile: '1234567890',
            password: hashedPassword,
            role: 'student',
            isProfileComplete: false // This forces them to fill profile on first login
        });
        console.log("Student Created! Mobile: 1234567890 | Pass: student123");
    } catch (err) {
        console.log("Error (maybe user exists):", err.message);
    }
    mongoose.connection.close();
});