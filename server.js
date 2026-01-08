require('dotenv').config();
const express = require('express');
const compression = require('compression');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo').default;
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const User = require('./models/User');
const Content = require('./models/Content');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// Database Connection
const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/freeSolutions';

mongoose.connect(dbURI)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(session({
    name: 'freesolutions.sid',
    secret: process.env.SESSION_SECRET || 'mySuperSecretKey123',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));


// --- CLOUDINARY SETUP ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'school-app-uploads', // The folder name in your Cloudinary dashboard
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});


const upload = multer({
    storage: storage,
    limits:{fileSize: 2000000} // Limit to 2MB
});

// --- Authentication Middleware ---
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/login');
};

const isAdmin = (req, res, next) => {
    if (req.session.role === 'admin') return next();
    res.redirect('/login');
};
// Add this BEFORE your app.get() routes
app.use((req, res, next) => {
    // If a user is logged in, make their profile available to ALL EJS files
    res.locals.user = req.session.userProfile || null; 
    next();
});

// --- Routes ---
// Temporary Registration Route for testing
app.get('/register-test', (req, res) => {
    res.render('registration-form'); // Reusing the profile form for now
});

app.post('/register-test', async (req, res) => {
    const { name, mobile, password } = req.body;
    // We need to hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await User.create({
        mobile, 
        password: hashedPassword,
        name,
        role: 'student', 
        isProfileComplete: false
    });
    res.redirect('/login');
});

// 5. Profile Route (Updated for Separation)
app.get('/profile', isAuthenticated, (req, res) => {
    
    if (req.session.role === 'admin') {
        // Render the separate Admin file
        res.render('admin-profile', { user: req.session.userProfile });
    } else {
        // Render the standard Student file
        res.render('profile', { user: req.session.userProfile });
    }

});

// Route for the Add Solution Page
app.get('/admin/add-solution', async (req, res) => {
    // Check if user is logged in (and is admin)
    if (!req.session.userId) { // Or however you check login
        return res.redirect('/login');
    }

    try {
        // 1. GET ALL SOLUTIONS from the database
        // .lean() makes it faster for just displaying lists
        const allSolutions = await Content.find({}).sort({ _id: -1 }); 

        // 2. RENDER the page and pass the data
        res.render('add-solution', { 
            user: req.session.userProfile, // Adjust based on how you store user in session
            questions: allSolutions 
        });

    } catch (error) {
        console.log("Error fetching solutions:", error);
        res.status(500).send("Error loading page");
    }
});

// 1. Auth Routes
app.get('/', (req, res) => res.redirect('/login'));

// 1. GET ROUTE: Now checks for 'error' in the URL query
app.get('/login', (req, res) => {
    // If the URL is /login?error=Invalid..., we grab that message
    const errorMessage = req.query.error || null;
    
    res.render('login', { error: errorMessage });
});

// 2. POST ROUTE: Redirects on failure instead of rendering
app.post('/login', async (req, res) => {
    const { mobile, password } = req.body;
    
    try {
        const user = await User.findOne({ mobile });
        
        // CHECK LOGIN FAILURE
        if (!user || !await bcrypt.compare(password, user.password)) {
            // FIX: Redirect back to GET route with error in URL
            // encodeURIComponent ensures special characters don't break the URL
            return res.redirect('/login?error=' + encodeURIComponent('Invalid Mobile or Password'));
        }
        
        // SUCCESS: Set Session
        req.session.userId = user._id;
        req.session.role = user.role;
        req.session.userProfile = user;

        // Redirect based on Role
        if (user.role === 'admin') {
            res.redirect('/admin/dashboard');
        } else {
            if (!user.isProfileComplete) {
                res.redirect('/student/register');
            } else {
                res.redirect('/student/dashboard');
            }
        }
        
    } catch (err) {
        console.error(err);
        // FIX: Redirect on server error too
        res.redirect('/login?error=' + encodeURIComponent('Server Error'));
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// --- HANDLE PROFILE UPDATE (Registration) ---
app.post('/update-profile', isAuthenticated, async (req, res) => {
    try {
        const { name, studentClass, medium } = req.body;
        const userId = req.session.user._id;

        // 1. Update the user in the database
        const updatedUser = await User.findByIdAndUpdate(userId, {
            name: name,
            studentClass: studentClass,
            medium: medium,
            isProfileComplete: true // IMPORTANT: Mark them as active
        }, { new: true });

        // 2. Update the session with new data so they don't have to re-login
        req.session.user = updatedUser;

        // 3. Redirect to the Main Dashboard
        res.redirect('/student/dashboard');

    } catch (err) {
        console.log(err);
        res.send("Error updating profile. Please try again.");
    }
});
// =============================================================
// 2. Student Registration (UPDATED FOR NEW ACCOUNTS)
// =============================================================

// GET: Show the form (Removed 'isAuthenticated' so new users can see it)
app.get('/student/register', (req, res) => {
    res.render('registration-form', { user: null, error: null });
});

// POST: Create the New User (Removed 'isAuthenticated' and added Creation Logic)
app.post('/student/register', async (req, res) => {
    try {
        const { 
            name, 
            mobile, 
            password,  // <--- Crucial: Getting password from form
            fatherName,
            dob, 
            studentClass, 
            medium, 
            gender, 
            schoolName 
        } = req.body;

        // 1. Check if user already exists
        const existingUser = await User.findOne({ mobile: mobile });
        if (existingUser) {
            return res.render('registration-form', { 
                user: null, 
                error: "❌ Mobile number already registered. Please Login." 
            });
        }

        // 2. HASH THE PASSWORD (Crucial Step!)
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Create the new User
        const newUser = new User({
            name,
            mobile,
            password: hashedPassword, // <--- Saving the secure hash
            fatherName,
            dob: dob,
            studentClass,
            medium,
            gender,
            schoolName,
            role: 'student',          // Default role
            isProfileComplete: true   // Profile is done
        });

        // 4. Save to Database
        await newUser.save();

        // 5. Redirect to Login
        res.render('login', { error: "✅ Account Created! Please Login." });

    } catch (err) {
        console.log(err);
        res.send("Error creating account. Please try again.");
    }
});

app.get('/admin/dashboard', isAuthenticated, isAdmin, (req, res) => {
    res.render('admin-dashboard', { 
        success: req.query.success,
        error: req.query.error, // <--- ADD THIS LINE
        user: req.session.userProfile,
        formData: req.query
    });
});

// POST Route: Upload Solution
app.post('/admin/add-solution', upload.single('questionImage'), async (req, res) => {
    try {
        // 1. EXTRACT DATA
        const { 
            classLevel, medium, subject, chapterName, exercise, 
            questionNumber, questionDescription, videoID, textSolution 
        } = req.body;

        // 2. CREATE NEW CONTENT
        const newContent = new Content({
            classLevel, medium, subject, chapterName, exercise,
            questionNumber, questionDescription, videoID, textSolution,
            questionImage: req.file ? req.file.path : null
        });

        // 3. SAVE TO DB
        await newContent.save();

        // =========================================================
        // 🚀 FIX: REDIRECT INSTEAD OF RENDER
        // This forces the browser to load the dashboard "fresh"
        // We add ?success=true to tell the dashboard to show the green alert
        // =========================================================
        res.redirect('/admin/dashboard?success=true');

    } catch (err) {
        console.error("Upload Error:", err);
        
        // IF ERROR: We still Render (not redirect) so we don't lose the user's typed text
        const allQuestions = await Content.find({}).sort({ _id: -1 });
        res.render('admin-dashboard', { 
            success: false, 
            error: "Error: " + err.message,
            formData: req.body, 
            questions: allQuestions 
        });
    }
});
// --- ADD THIS TO SERVER.JS (The Database Route) ---

app.get('/admin/database', async (req, res) => { // OR '/admin/dashboard' if that's your route
    try {
        // ✅ SORT FIX: Show questions edited most recently at the top
        const allQuestions = await Content.find({}).sort({ updatedAt: -1 });

        res.render('admin-database', { // OR 'admin-dashboard'
            questions: allQuestions,
            success: req.query.success === 'true',
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.send("Error loading database: " + err.message);
    }
});

// 4. Student Dashboard & Logic
app.get('/student/dashboard', isAuthenticated, (req, res) => {
    // If admin is "viewing as student", we might need dummy data or handle gracefully
    // Here we assume logged in user has profile data
    res.render('student-dashboard', { user: req.session.userProfile });
});

/// ✅ KEEP (OR ADD) THIS SINGLE CLEAN VERSION
app.get('/content/:subject', isAuthenticated, async (req, res) => {
    const { subject } = req.params;
    const { studentClass, medium } = req.session.userProfile;

    // 1. Fetch Chapters (Filters by Class & Medium automatically)
    const chapters = await Content.find({ 
        classLevel: studentClass, 
        medium: medium, 
        subject: subject 
    }).distinct('chapterName');
    
    // 2. Render Page (Title is ALWAYS the Subject Name, e.g., "Mathematics")
    res.render('chapter-list', { 
        title: subject,       
        subject: subject, 
        chapters: chapters,
        backLink: '/student/dashboard'
    });
});

// Chapter View -> Logic for Math vs Science
app.get('/content/:subject/:chapter', isAuthenticated, async (req, res) => {
    const { subject, chapter } = req.params;
    const { studentClass, medium } = req.session.userProfile;

    if (subject === 'Mathematics') {
        // Show Exercises
        const exercises = await Content.find({ classLevel: studentClass, medium, subject, chapterName: chapter })
                                       .distinct('exercise');
        res.render('exercise-list', { 
            title: chapter, // <--- Shows Chapter Name (e.g. Real Numbers)
            subject, 
            chapter, 
            exercises,
            backLink: `/content/${subject}` // <--- Back button goes to Subject Page
        });
    } else {
        // Science: Go straight to questions
        const questions = await Content.find({ classLevel: studentClass, medium, subject, chapterName: chapter });
        res.render('question-list', { 
            title: chapter, // <--- Shows Chapter Name (e.g. Force)
            subject, 
            chapter, 
            questions, 
            exercise: null,
            backLink: `/content/${subject}` // <--- Back button goes to Subject Page
        });
    }
});

// Exercise View (Math Only) -> List Questions
app.get('/content/:subject/:chapter/:exercise', isAuthenticated, async (req, res) => {
    const { subject, chapter, exercise } = req.params;
    const { studentClass, medium } = req.session.userProfile;

    const questions = await Content.find({ 
        classLevel: studentClass, medium, subject, chapterName: chapter, exercise 
    });
    
    res.render('question-list', { 
        title: `Exercise ${exercise}`, // <--- Shows "Exercise 1.1"
        subject, 
        chapter, 
        questions, 
        exercise,
        backLink: `/content/${subject}/${chapter}` // <--- Back button goes to Chapter Page
    });
});

// Solution View (Player)
app.get('/solution/:id', isAuthenticated, async (req, res) => {
    const content = await Content.findById(req.params.id);

    // Smart Back Button: If it has an exercise (Math), go back to Exercise List.
    // If not (Science), go back to Chapter List.
    let backLink = '';
    if (content.exercise) {
        backLink = `/content/${content.subject}/${content.chapterName}/${content.exercise}`;
    } else {
        backLink = `/content/${content.subject}/${content.chapterName}`;
    }

    res.render('content-view', { 
        title: `Question ${content.questionNumber}`, // <--- Shows "Question 5"
        content,
        backLink: backLink 
    });
});

// --- FORGOT PASSWORD ROUTES ---

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { error: null });
});

app.post('/verify-user', async (req, res) => {
    const { mobile, dob } = req.body; // <--- 1. Get DOB from form
    try {
        // 2. Check if user exists with this Mobile AND Date of Birth
        const user = await User.findOne({ mobile: mobile, dob: dob });

        if (!user) {
            return res.render('forgot-password', { error: '❌ Details do not match (Wrong Mobile or DOB).' });
        }

        // If found, send them to Reset Page with their User ID
        res.render('reset-password', { userId: user._id });

    } catch (err) {
        console.log(err);
        res.render('forgot-password', { error: 'Server Error' });
    }
});

app.post('/reset-password-final', async (req, res) => {
    const { userId, newPassword } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(userId, { password: hashedPassword });

        res.render('login', { error: '✅ Password Reset! Please Login.' });
    } catch (err) {
        res.send("Error resetting password.");
    }
});

// --- Change Password Routes ---

// 1. Show the Form
app.get('/change-password', isAuthenticated, (req, res) => {
    res.render('change-password', { 
        user: req.session.userProfile,
        error: null, 
        success: null 
    });
});

// 2. Handle the Update Logic
// --- POST ROUTE: Handle Password Change Logic ---
app.post('/change-password', async (req, res) => {
    
    // 1. Check if user is logged in
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { oldPassword, newPassword, confirmPassword } = req.body;

    // 2. Input Validation (Do passwords match?)
    if (newPassword !== confirmPassword) {
        return res.render('change-password', {
            title: 'Change Password',
            user: req.session.userProfile, // Keep the header working
            error: 'New passwords do not match.',
            success: null
        });
    }

    // 3. Minimum Length Check
    if (newPassword.length < 6) {
        return res.render('change-password', {
            title: 'Change Password',
            user: req.session.userProfile,
            error: 'Password must be at least 6 characters long.',
            success: null
        });
    }

    try {
        // 4. Find the User in Database
        // We use the ID stored in the session when they logged in
        const user = await User.findById(req.session.userId);

        // 5. Verify OLD Password
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        
        if (!isMatch) {
            return res.render('change-password', {
                title: 'Change Password',
                user: req.session.userProfile,
                error: 'Incorrect current password.',
                success: null
            });
        }

        // 6. Hash the NEW Password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 7. Update and Save
        user.password = hashedPassword;
        await user.save();

        // 8. Success!
        res.render('change-password', {
            title: 'Change Password',
            user: req.session.userProfile,
            error: null,
            success: 'Password changed successfully!'
        });

    } catch (err) {
        console.error(err);
        res.render('change-password', {
            title: 'Change Password',
            user: req.session.userProfile,
            error: 'Server error. Please try again.',
            success: null
        });
    }
});

app.get('/contact', isAuthenticated, (req, res) => {
    // Renders the new contact.ejs file
    res.render('contact', { user: req.session.userProfile });
});

// --- DELETE ROUTE ---
app.get('/admin/delete/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        await Content.findByIdAndDelete(req.params.id);
        res.redirect('/admin/database');
    } catch (err) {
        res.send("Error deleting: " + err.message);
    }
});

app.get('/admin/edit/:id', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        
        // Fetch ALL data for this subject (Only need names, not full descriptions)
        const rawData = await Content.find(
            { subject: content.subject }, 
            { medium: 1, chapterName: 1, exercise: 1 } 
        );

        // Build the Map: { English: { 'Trigonometry': ['8.1', '8.2'] }, Hindi: { ... } }
        const dataMap = { English: {}, Hindi: {} };

        rawData.forEach(item => {
            const med = item.medium; 
            const chap = item.chapterName;
            const ex = item.exercise;

            // Initialize Chapter if missing
            if (dataMap[med] && !dataMap[med][chap]) {
                dataMap[med][chap] = new Set();
            }

            // Add Exercise (if exists and map is valid)
            if (ex && dataMap[med] && dataMap[med][chap]) {
                dataMap[med][chap].add(ex);
            }
        });

        // Convert Sets to Arrays for the frontend
        const finalMap = { English: {}, Hindi: {} };
        ['English', 'Hindi'].forEach(med => {
            Object.keys(dataMap[med]).sort().forEach(chap => {
                finalMap[med][chap] = Array.from(dataMap[med][chap]).sort();
            });
        });

        res.render('edit-solution', { 
            content,
            dataMap: finalMap // 👈 Sending the structured map
        });

    } catch (err) {
        console.error("Error loading edit page:", err);
        res.redirect('/admin/database?error=Could not load solution');
    }
});

// --- EDIT ROUTE (Save the Changes) ---
app.post('/admin/edit/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { 
            classLevel, medium, subject, chapterName, exercise, 
            questionNumber, questionDescription, videoID, textSolution 
        } = req.body;

        await Content.findByIdAndUpdate(req.params.id, {
            classLevel, medium, subject, chapterName, exercise, 
            questionNumber, questionDescription, videoID, textSolution
        });

        res.redirect('/admin/database');
    } catch (err) {
        res.send("Error updating: " + err.message);
    }
});

// Global Error Handler
app.use((err, req, res, next) => {
    // 1. Catch Multer "File Too Large" Error
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        
        // Create a URL query string with the existing form data
        // We use encodeURIComponent to handle special characters safely
        const queryParams = new URLSearchParams({
            error: 'File too large! Max limit is 2MB.',
            // Preserve the text fields:
            classLevel: req.body.classLevel || '',
            medium: req.body.medium || '',
            subject: req.body.subject || '',
            chapterName: req.body.chapterName || '',
            exercise: req.body.exercise || '',
            questionNo: req.body.questionNo || '',
            questionDescription: req.body.questionDescription || '',
            videoLink: req.body.videoLink || ''
        }).toString();

        // Redirect back with the data
        return res.redirect('/admin/dashboard?' + queryParams);
    }

    if (err) {
        return res.redirect('/admin/dashboard?error=' + err.message);
    }
    next();
});

// app.listen is usually here...
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));