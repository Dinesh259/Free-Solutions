require('dotenv').config(); // <--- 1. Add this at the VERY TOP
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// <--- 2. Update this line to use the Cloud URI or fallback to Local
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/freeSolutions')
.then(async () => {
    
    // The rest of your code stays exactly the same
    const hashedPassword = await bcrypt.hash('student123', 10);
    
    try {
        await User.create({
            mobile: '1234567890',
            password: hashedPassword,
            role: 'student',
            isProfileComplete: false 
        });
        console.log("Student Created! Mobile: 1234567890 | Pass: student123");
    } catch (err) {
        console.log("Error (maybe user exists):", err.message);
    }
    mongoose.connection.close();
})
.catch(err => console.log(err)); // Good practice to catch connection errors