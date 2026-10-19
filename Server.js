require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const adminHtmlTemplate = require('./admin.js');

const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Allowed for inline scripts in generated HTML
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts' } });
app.use('/api/', apiLimiter);
app.use('/api/admin/login', authLimiter);

// --- MongoDB Schemas & Connection ---
let cachedDb = null;
async function connectDB() {
    if (cachedDb) return cachedDb;
    if (!process.env.MONGODB_URI) throw new Error("CRITICAL: MONGODB_URI environment variable is missing.");
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    cachedDb = conn;
    return conn;
}

const clinicSettingsSchema = new mongoose.Schema({
    name: String, tagline: String, email: String, phone: String, address: String, timezone: String,
    openingHours: [{ day: Number, name: String, isOpen: Boolean, open: String, close: String }]
});
const ClinicSettings = mongoose.models.ClinicSettings || mongoose.model('ClinicSettings', clinicSettingsSchema);

const serviceSchema = new mongoose.Schema({
    name: String, description: String, price: Number, duration: Number, active: Boolean, image: String
});
const Service = mongoose.models.Service || mongoose.model('Service', serviceSchema);

const dentistSchema = new mongoose.Schema({
    name: String, specialty: String, bio: String, image: String, active: Boolean
});
const Dentist = mongoose.models.Dentist || mongoose.model('Dentist', dentistSchema);

const adminSchema = new mongoose.Schema({ email: { type: String, unique: true }, passwordHash: String });
const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

const appointmentSchema = new mongoose.Schema({
    reference: { type: String, unique: true },
    patientName: String, email: String, phone: String, serviceId: mongoose.Schema.Types.ObjectId,
    dentistId: mongoose.Schema.Types.ObjectId, date: String, time: String,
    status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
    reason: String
}, { timestamps: true });
const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);

const contactSchema = new mongoose.Schema({ name: String, email: String, phone: String, subject: String, message: String }, { timestamps: true });
const ContactMessage = mongoose.models.ContactMessage || mongoose.model('ContactMessage', contactSchema);

// Database Middleware wrapper for all routes
app.use(async (req, res, next) => {
    try { await connectDB(); next(); } 
    catch (err) { console.error(err); res.status(500).json({ error: "Database Connection Failed" }); }
});

// Seed Data
async function seedDatabase() {
    const settingsCount = await ClinicSettings.countDocuments();
    if (settingsCount === 0) {
        console.log("Seeding database from index.json...");
        const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'index.json'), 'utf8'));
        await ClinicSettings.create(seedData.clinic);
        await Service.insertMany(seedData.services);
        await Dentist.insertMany(seedData.dentists);
    }
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        await Admin.create({ email: process.env.ADMIN_EMAIL, passwordHash: hash });
    }
}
connectDB().then(seedDatabase).catch(console.error);

// --- Auth Middleware ---
const authenticateAdmin = (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
        req.adminId = decoded.adminId;
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

// --- PUBLIC APIs ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/api/config', async (req, res) => res.json(await ClinicSettings.findOne()));
app.get('/api/services', async (req, res) => res.json(await Service.find({ active: true })));
app.get('/api/dentists', async (req, res) => res.json(await Dentist.find({ active: true })));

app.get('/api/availability', async (req, res) => {
    const { date, dentistId } = req.query;
    if (!date || !dentistId) return res.status(422).json({ error: "Date and Dentist required" });
    
    const settings = await ClinicSettings.findOne();
    const reqDateObj = new Date(date);
    const dayOfWeek = reqDateObj.getDay();
    const dayConfig = settings.openingHours.find(h => h.day === dayOfWeek);
    
    if (!dayConfig || !dayConfig.isOpen) return res.json({ slots: [] });

    // TZ handling (Asia/Karachi)
    const nowKHIStr = new Date().toLocaleString('en-US', { timeZone: settings.timezone || 'Asia/Karachi' });
    const nowKHI = new Date(nowKHIStr);
    const reqDateKHI = new Date(reqDateObj.toLocaleString('en-US', { timeZone: settings.timezone || 'Asia/Karachi' }));
    
    // If requested date is past date in local tz
    if (reqDateObj < new Date(nowKHI.getFullYear(), nowKHI.getMonth(), nowKHI.getDate())) return res.json({ slots: [] });
    const isToday = reqDateObj.getTime() === new Date(nowKHI.getFullYear(), nowKHI.getMonth(), nowKHI.getDate()).getTime();

    const appointments = await Appointment.find({ dentistId, date, status: { $in: ['pending', 'confirmed'] } });
    const bookedTimes = appointments.map(a => a.time);

    let slots = [];
    let [openH, openM] = dayConfig.open.split(':').map(Number);
    let [closeH, closeM] = dayConfig.close.split(':').map(Number);
    
    let currentMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;
    const nowMins = nowKHI.getHours() * 60 + nowKHI.getMinutes();

    while (currentMins + 30 <= closeMins) {
        const h = Math.floor(currentMins / 60).toString().padStart(2, '0');
        const m = (currentMins % 60).toString().padStart(2, '0');
        const timeStr = h + ':' + m;
        
        if (!bookedTimes.includes(timeStr)) {
            if (!isToday || currentMins > nowMins + 60) { // 1 hour buffer if booking today
                slots.push(timeStr);
            }
        }
        currentMins += 30; // 30 min fixed intervals
    }
    res.json({ slots });
});

app.post('/api/appointments', async (req, res) => {
    const { patientName, email, phone, serviceId, dentistId, date, time, reason } = req.body;
    if (!patientName || !email || !phone || !date || !time) return res.status(422).json({ error: "Missing required fields" });

    // Re-check conflict
    const conflict = await Appointment.findOne({ dentistId, date, time, status: { $in: ['pending', 'confirmed'] } });
    if (conflict) return res.status(409).json({ error: "This time slot is no longer available." });

    const ref = 'PS-' + new Date().getFullYear() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const appt = new Appointment({ reference: ref, patientName, email, phone, serviceId, dentistId, date, time, reason });
    await appt.save();
    res.json({ success: true, reference: ref, status: 'pending' });
});

app.post('/api/contact', async (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    await ContactMessage.create({ name, email, phone, subject, message });
    res.json({ success: true });
});

// --- ADMIN APIs ---
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) return res.status(401).json({ error: "Invalid credentials" });
    
    const token = jwt.sign({ adminId: admin._id }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });
    res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 });
    res.json({ success: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('auth_token'); res.json({ success: true }); });
app.get('/api/admin/me', authenticateAdmin, (req, res) => res.json({ success: true }));

app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const [total, pending, todayAppts, recent] = await Promise.all([
        Appointment.countDocuments(),
        Appointment.countDocuments({ status: 'pending' }),
        Appointment.countDocuments({ date: todayStr }),
        Appointment.find().sort({ createdAt: -1 }).limit(50).populate('dentistId').populate('serviceId')
    ]);
    res.json({ stats: { total, pending, today: todayAppts }, appointments: recent });
});

app.patch('/api/admin/appointments/:id', authenticateAdmin, async (req, res) => {
    const allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!allowedStatuses.includes(req.body.status)) return res.status(422).json({ error: "Invalid status" });
    await Appointment.findByIdAndUpdate(req.params.id, { status: req.body.status });
    res.json({ success: true });
});

app.get('/api/admin/messages', authenticateAdmin, async (req, res) => {
    res.json(await ContactMessage.find().sort({ createdAt: -1 }).limit(50));
});

// --- UI ROUTING ---
app.get('/admin', (req, res) => {
    res.send(adminHtmlTemplate);
});

// Generate and serve Public Website HTML dynamically
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PearlSmile Dental Clinic | Your Happiest Smile Starts Here</title>
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --bg: #FFF9F0; --primary: #A8E6CF; --secondary: #A8D8F0;
            --accent: #D9C9FF; --coral: #FFB4A2; --text: #263238; --white: #FFFFFF;
            --clay-shadow: 8px 8px 16px #d1d9e6, -8px -8px 16px #ffffff, inset 2px 2px 4px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.04);
            --clay-hover: 12px 12px 20px #c5cddb, -12px -12px 20px #ffffff, inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.05);
            --clay-inset: inset 6px 6px 12px #d1d9e6, inset -6px -6px 12px #ffffff;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Nunito', sans-serif; scroll-behavior: smooth; }
        body { background-color: var(--bg); color: var(--text); overflow-x: hidden; }
        h1, h2, h3, h4 { font-family: 'Poppins', sans-serif; }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
        section { padding: 6rem 0; }
        
        /* Nav */
        nav { position: fixed; top: 0; width: 100%; background: rgba(255, 249, 240, 0.85); backdrop-filter: blur(10px); z-index: 100; padding: 1rem 0; box-shadow: 0 4px 30px rgba(0,0,0,0.05); }
        .nav-inner { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-family: 'Poppins', sans-serif; font-size: 1.5rem; font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 0.5rem; text-decoration: none; }
        .nav-links { display: flex; gap: 2rem; align-items: center; }
        .nav-links a { text-decoration: none; color: var(--text); font-weight: 600; transition: color 0.3s; }
        .nav-links a:hover { color: var(--primary); }
        
        /* Clay Components */
        .clay-card { background: var(--white); border-radius: 28px; box-shadow: var(--clay-shadow); padding: 2rem; transition: transform 0.3s ease, box-shadow 0.3s; }
        .clay-card:hover { transform: translateY(-5px); box-shadow: var(--clay-hover); }
        
        .clay-btn { background: var(--primary); border: none; border-radius: 20px; padding: 1rem 2rem; font-size: 1.1rem; font-weight: 700; color: var(--text); cursor: pointer; box-shadow: var(--clay-shadow); transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; }
        .clay-btn:hover { transform: translateY(-3px); box-shadow: var(--clay-hover); }
        .clay-btn:active { transform: translateY(0); box-shadow: var(--clay-inset); }
        .clay-btn.secondary { background: var(--secondary); }
        .clay-btn.accent { background: var(--accent); }
        
        .clay-input { width: 100%; border: none; background: var(--bg); border-radius: 16px; padding: 1.2rem; box-shadow: var(--clay-inset); outline: none; font-size: 1rem; margin-bottom: 1.5rem; color: var(--text); font-family: 'Nunito', sans-serif; }
        select.clay-input { appearance: none; cursor: pointer; }
        
        /* Hero */
        .hero { min-height: 100vh; display: flex; align-items: center; padding-top: 5rem; position: relative; overflow: hidden; }
        .hero-content { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; }
        .hero-text h1 { font-size: 3.5rem; line-height: 1.2; margin-bottom: 1.5rem; }
        .hero-text p { font-size: 1.2rem; margin-bottom: 2.5rem; opacity: 0.8; }
        .hero-image { position: relative; border-radius: 40px; overflow: hidden; box-shadow: var(--clay-shadow); }
        .hero-image img { width: 100%; height: auto; display: block; }
        .floating-badge { position: absolute; background: var(--white); padding: 1rem 1.5rem; border-radius: 20px; box-shadow: var(--clay-shadow); font-weight: 700; display: flex; align-items: center; gap: 0.5rem; animation: float 4s ease-in-out infinite; }
        .badge-1 { top: 10%; left: -20px; }
        .badge-2 { bottom: 10%; right: -20px; animation-delay: 2s; }
        
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }
        
        /* Grids */
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
        .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; }
        
        /* Specific Sections */
        .section-title { text-align: center; margin-bottom: 4rem; }
        .section-title h2 { font-size: 2.5rem; margin-bottom: 1rem; }
        .section-title p { opacity: 0.8; max-width: 600px; margin: 0 auto; }
        
        .service-img { width: 100%; height: 200px; object-fit: cover; border-radius: 16px; margin-bottom: 1.5rem; }
        .dentist-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; margin: 0 auto 1.5rem; display: block; border: 4px solid var(--primary); }
        
        /* Modal for Booking */
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(38,50,56,0.6); backdrop-filter: blur(5px); z-index: 1000; display: flex; justify-content: center; align-items: center; opacity: 0; visibility: hidden; transition: all 0.3s; }
        .modal-overlay.active { opacity: 1; visibility: visible; }
        .modal-content { max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; position: relative; }
        .close-modal { position: absolute; top: 1.5rem; right: 1.5rem; cursor: pointer; background: var(--bg); border: none; border-radius: 50%; padding: 0.5rem; box-shadow: var(--clay-shadow); }
        
        .slots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
        .slot-btn { background: var(--bg); border: none; padding: 0.8rem; border-radius: 12px; font-weight: 700; cursor: pointer; box-shadow: var(--clay-shadow); transition: 0.2s; }
        .slot-btn:hover { background: var(--primary); }
        .slot-btn.selected { background: var(--primary); box-shadow: var(--clay-inset); }
        
        footer { background: var(--white); padding: 4rem 0 2rem; border-top-left-radius: 40px; border-top-right-radius: 40px; box-shadow: 0 -10px 30px rgba(0,0,0,0.02); }
        
        /* Animations */
        .animate-on-scroll { opacity: 0; transform: translateY(30px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-on-scroll.visible { opacity: 1; transform: translateY(0); }

        @media (max-width: 768px) {
            .hero-content { grid-template-columns: 1fr; text-align: center; }
            .nav-links { display: none; } /* Add hamburger for production scale */
            .floating-badge { display: none; }
        }
    </style>
</head>
<body>

    <nav>
        <div class="container nav-inner">
            <a href="#" class="logo"><i data-lucide="smile" fill="var(--primary)" color="var(--text)"></i> PearlSmile</a>
            <div class="nav-links">
                <a href="#services">Services</a>
                <a href="#dentists">Our Dentists</a>
                <a href="#about">About Us</a>
                <a href="#contact">Contact</a>
                <button class="clay-btn" style="padding: 0.6rem 1.2rem; font-size: 1rem;" onclick="openBooking()">Book Appointment</button>
            </div>
        </div>
    </nav>

    <section class="hero">
        <div class="container hero-content">
            <div class="hero-text animate-on-scroll visible">
                <h1>A Brighter Smile,<br>A Healthier You.</h1>
                <p>Gentle, modern dental care designed around you. Meet our friendly team and book your visit in just a few clicks.</p>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                    <button class="clay-btn" onclick="openBooking()">Book Your Visit <i data-lucide="calendar"></i></button>
                    <a href="#services" class="clay-btn secondary">Explore Services</a>
                </div>
            </div>
            <div class="hero-image animate-on-scroll visible">
                <img src="https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=800&q=80" alt="Modern Dental Clinic">
                <div class="floating-badge badge-1"><i data-lucide="heart" color="var(--coral)"></i> Gentle Care</div>
                <div class="floating-badge badge-2"><i data-lucide="star" color="var(--accent)"></i> Top Rated</div>
            </div>
        </div>
    </section>

    <section id="trust" style="background: var(--white);">
        <div class="container grid-4">
            <div class="clay-card animate-on-scroll" style="text-align: center;"><i data-lucide="award" size="40" color="var(--primary)"></i><h3 style="margin: 1rem 0;">Experienced Team</h3><p>Demo: Highly qualified professionals dedicated to your smile.</p></div>
            <div class="clay-card animate-on-scroll" style="text-align: center;"><i data-lucide="coffee" size="40" color="var(--secondary)"></i><h3 style="margin: 1rem 0;">Comfortable Care</h3><p>Demo: Relax in our modern, stress-free environment.</p></div>
            <div class="clay-card animate-on-scroll" style="text-align: center;"><i data-lucide="zap" size="40" color="var(--accent)"></i><h3 style="margin: 1rem 0;">Modern Tech</h3><p>Demo: Utilizing the latest digital dentistry tools.</p></div>
            <div class="clay-card animate-on-scroll" style="text-align: center;"><i data-lucide="smartphone" size="40" color="var(--coral)"></i><h3 style="margin: 1rem 0;">Easy Booking</h3><p>Demo: Instant online scheduling available 24/7.</p></div>
        </div>
    </section>

    <section id="services">
        <div class="container">
            <div class="section-title animate-on-scroll">
                <h2>Our Dental Services</h2>
                <p>Comprehensive care for all your dental needs. (Illustrative prices in PKR).</p>
            </div>
            <div class="grid-3" id="services-container">
                <!-- Dynamically loaded -->
                <p style="text-align: center; width: 100%;">Loading services...</p>
            </div>
        </div>
    </section>

    <section id="dentists" style="background: var(--white);">
        <div class="container">
            <div class="section-title animate-on-scroll">
                <h2>Meet Our Dentists</h2>
                <p>Friendly, fictional experts ready to take care of your smile.</p>
            </div>
            <div class="grid-4" id="dentists-container">
                 <!-- Dynamically loaded -->
            </div>
        </div>
    </section>

    <section id="about">
        <div class="container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center;">
            <div class="animate-on-scroll">
                <img src="https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=600&q=80" style="border-radius: 40px; width: 100%; box-shadow: var(--clay-shadow);">
            </div>
            <div class="animate-on-scroll">
                <h2 style="font-size: 2.5rem; margin-bottom: 1.5rem;">Comfortable, personalized preventive care.</h2>
                <p style="margin-bottom: 1.5rem; line-height: 1.8;">At PearlSmile (Fictional Demo), our mission is to redefine the dental experience. We believe going to the dentist shouldn't be stressful. From our puffy claymorphism chairs to our gentle approach, your comfort is paramount.</p>
                <div style="display: flex; gap: 2rem; margin-bottom: 2rem;">
                    <div class="clay-card" style="padding: 1.5rem;"><h3 style="color: var(--primary); font-size: 2rem;">5k+</h3><p>Happy Smiles</p></div>
                    <div class="clay-card" style="padding: 1.5rem;"><h3 style="color: var(--secondary); font-size: 2rem;">12+</h3><p>Years Exp.</p></div>
                </div>
                <button class="clay-btn" onclick="openBooking()">Join Our Clinic</button>
            </div>
        </div>
    </section>

    <section id="contact" style="background: var(--white);">
        <div class="container grid-3">
            <div class="clay-card animate-on-scroll" style="grid-column: span 1;">
                <h3>Contact Info</h3>
                <p style="margin: 1.5rem 0;"><i data-lucide="map-pin" color="var(--primary)"></i> 24 Blossom Avenue, Gulberg, Lahore</p>
                <p style="margin: 1.5rem 0;"><i data-lucide="phone" color="var(--secondary)"></i> +92 300 555 0182</p>
                <p style="margin: 1.5rem 0;"><i data-lucide="mail" color="var(--accent)"></i> hello@pearlsmile.example</p>
                <div style="margin-top: 2rem; background: var(--bg); padding: 1rem; border-radius: 16px; font-weight: bold; color: var(--coral);">
                    <i data-lucide="alert-circle"></i> EMERGENCY NOTICE:<br>For genuine medical emergencies, please visit the nearest hospital. This is a demo.
                </div>
            </div>
            <div class="clay-card animate-on-scroll" style="grid-column: span 2;">
                <h3>Send a Message</h3>
                <form id="contact-form" style="margin-top: 1.5rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <input type="text" id="c-name" class="clay-input" placeholder="Your Name" required>
                        <input type="email" id="c-email" class="clay-input" placeholder="Your Email" required>
                    </div>
                    <input type="text" id="c-subject" class="clay-input" placeholder="Subject" required>
                    <textarea id="c-msg" class="clay-input" placeholder="Message" rows="4" required></textarea>
                    <button type="submit" class="clay-btn secondary">Send Message</button>
                    <p id="c-response" style="margin-top: 1rem; color: var(--primary); font-weight: bold;"></p>
                </form>
            </div>
        </div>
    </section>

    <footer>
        <div class="container" style="text-align: center;">
            <h2 style="color: var(--primary); margin-bottom: 1rem;">PearlSmile</h2>
            <p>Your Happiest Smile Starts Here.</p>
            <p style="margin-top: 2rem; font-size: 0.9rem; opacity: 0.6;">&copy; <span id="year"></span> PearlSmile Demo. Not a real clinic.</p>
        </div>
    </footer>

    <!-- Booking Modal -->
    <div class="modal-overlay" id="booking-modal">
        <div class="clay-card modal-content">
            <button class="close-modal" onclick="closeBooking()"><i data-lucide="x"></i></button>
            <h2 style="margin-bottom: 1.5rem;" id="modal-title">Book Appointment</h2>
            
            <div id="booking-step-1">
                <form id="booking-form-main">
                    <label><strong>1. Select Service</strong></label>
                    <select id="b-service" class="clay-input" required><option value="">Choose...</option></select>
                    
                    <label><strong>2. Select Dentist</strong></label>
                    <select id="b-dentist" class="clay-input" required><option value="">Choose...</option></select>
                    
                    <label><strong>3. Select Date</strong></label>
                    <input type="date" id="b-date" class="clay-input" required>
                    
                    <button type="button" class="clay-btn" id="btn-check-slots" style="width: 100%; justify-content: center;">Check Availability</button>
                </form>
            </div>

            <div id="booking-step-2" style="display: none;">
                <label><strong>4. Select Time</strong></label>
                <div id="slots-container" class="slots-grid"></div>
                <p id="no-slots-msg" style="color: var(--coral); display: none;">No slots available for this date.</p>
                
                <hr style="margin: 1.5rem 0; border: 1px solid var(--bg);">
                <label><strong>5. Your Details</strong></label>
                <input type="text" id="b-name" class="clay-input" placeholder="Full Name" required>
                <input type="email" id="b-email" class="clay-input" placeholder="Email Address" required>
                <input type="tel" id="b-phone" class="clay-input" placeholder="Phone Number" required>
                <textarea id="b-reason" class="clay-input" placeholder="Reason for visit (Optional)" rows="2"></textarea>
                
                <div style="display: flex; gap: 1rem;">
                    <button class="clay-btn secondary" onclick="goBackStep1()">Back</button>
                    <button class="clay-btn" id="btn-submit-booking" style="flex: 1; justify-content: center;">Confirm Booking</button>
                </div>
            </div>

            <div id="booking-step-3" style="display: none; text-align: center; padding: 2rem 0;">
                <i data-lucide="check-circle" size="64" color="var(--primary)" style="margin-bottom: 1rem;"></i>
                <h2>Booking Pending!</h2>
                <p style="margin: 1rem 0;">Your request has been received. Please keep your reference number:</p>
                <div style="background: var(--bg); padding: 1rem; border-radius: 12px; font-size: 1.5rem; font-family: monospace; font-weight: bold; letter-spacing: 2px; margin-bottom: 2rem;" id="b-reference"></div>
                <button class="clay-btn" onclick="closeBooking()">Done</button>
            </div>
        </div>
    </div>

    <script>
        lucide.createIcons();
        document.getElementById('year').textContent = new Date().getFullYear();

        // Animations
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if(entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));

        // Load Data
        let servicesData = [];
        let dentistsData = [];
        let selectedTime = null;

        async function loadInitialData() {
            try {
                const sRes = await fetch('/api/services');
                servicesData = await sRes.json();
                const sCont = document.getElementById('services-container');
                sCont.innerHTML = '';
                const bServ = document.getElementById('b-service');
                
                servicesData.forEach(s => {
                    const card = document.createElement('div');
                    card.className = 'clay-card animate-on-scroll';
                    card.innerHTML = 
                        '<img src="' + s.image + '" class="service-img" alt="' + s.name + '">' +
                        '<h3 style="margin-bottom:0.5rem;">' + s.name + '</h3>' +
                        '<p style="font-size:0.9rem; margin-bottom:1rem; min-height:45px;">' + s.description + '</p>' +
                        '<p style="font-weight:bold; color:var(--primary); margin-bottom:1.5rem;">From ' + s.price + ' PKR</p>' +
                        '<button class="clay-btn secondary" style="width:100%; justify-content:center;" onclick="openBooking(\\'' + s._id + '\\')">Book Service</button>';
                    sCont.appendChild(card);
                    
                    const opt = document.createElement('option');
                    opt.value = s._id; opt.textContent = s.name;
                    bServ.appendChild(opt);
                });

                const dRes = await fetch('/api/dentists');
                dentistsData = await dRes.json();
                const dCont = document.getElementById('dentists-container');
                dCont.innerHTML = '';
                const bDent = document.getElementById('b-dentist');
                
                dentistsData.forEach(d => {
                    const card = document.createElement('div');
                    card.className = 'clay-card animate-on-scroll';
                    card.style.textAlign = 'center';
                    card.innerHTML = 
                        '<img src="' + d.image + '" class="dentist-img" alt="' + d.name + '">' +
                        '<h3 style="margin-bottom:0.5rem;">' + d.name + '</h3>' +
                        '<p style="color:var(--secondary); font-weight:bold; margin-bottom:1rem;">' + d.specialty + '</p>' +
                        '<p style="font-size:0.9rem; margin-bottom:1.5rem;">' + d.bio + '</p>' +
                        '<button class="clay-btn accent" onclick="openBooking(null, \\'' + d._id + '\\')">Select</button>';
                    dCont.appendChild(card);
                    
                    const opt = document.createElement('option');
                    opt.value = d._id; opt.textContent = d.name + ' (' + d.specialty + ')';
                    bDent.appendChild(opt);
                });
                
                // Re-observe new elements
                document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
            } catch(e) { console.error('Error loading data', e); }
        }
        loadInitialData();

        // Contact Form
        document.getElementById('contact-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.textContent = 'Sending...';
            try {
                await fetch('/api/contact', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        name: document.getElementById('c-name').value,
                        email: document.getElementById('c-email').value,
                        subject: document.getElementById('c-subject').value,
                        message: document.getElementById('c-msg').value
                    })
                });
                document.getElementById('c-response').textContent = 'Message sent successfully!';
                e.target.reset();
            } catch(err) { document.getElementById('c-response').textContent = 'Error sending message.'; }
            btn.textContent = 'Send Message';
        });

        // Booking Logic
        const modal = document.getElementById('booking-modal');
        function openBooking(serviceId = null, dentistId = null) {
            document.getElementById('booking-step-1').style.display = 'block';
            document.getElementById('booking-step-2').style.display = 'none';
            document.getElementById('booking-step-3').style.display = 'none';
            if(serviceId) document.getElementById('b-service').value = serviceId;
            if(dentistId) document.getElementById('b-dentist').value = dentistId;
            
            // Prevent past dates in datepicker
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            document.getElementById('b-date').min = yyyy + '-' + mm + '-' + dd;
            
            modal.classList.add('active');
        }
        function closeBooking() { modal.classList.remove('active'); }
        function goBackStep1() {
            document.getElementById('booking-step-2').style.display = 'none';
            document.getElementById('booking-step-1').style.display = 'block';
        }

        document.getElementById('btn-check-slots').addEventListener('click', async () => {
            const serv = document.getElementById('b-service').value;
            const dent = document.getElementById('b-dentist').value;
            const date = document.getElementById('b-date').value;
            if(!serv || !dent || !date) return alert("Please select service, dentist, and date.");

            const btn = document.getElementById('btn-check-slots');
            btn.textContent = 'Checking...';
            
            try {
                const res = await fetch('/api/availability?date=' + date + '&dentistId=' + dent);
                const data = await res.json();
                
                const cont = document.getElementById('slots-container');
                const msg = document.getElementById('no-slots-msg');
                cont.innerHTML = '';
                selectedTime = null;

                if(data.slots && data.slots.length > 0) {
                    msg.style.display = 'none';
                    data.slots.forEach(slot => {
                        const b = document.createElement('button');
                        b.className = 'slot-btn';
                        b.textContent = slot;
                        b.onclick = () => {
                            document.querySelectorAll('.slot-btn').forEach(el => el.classList.remove('selected'));
                            b.classList.add('selected');
                            selectedTime = slot;
                        };
                        cont.appendChild(b);
                    });
                } else {
                    msg.style.display = 'block';
                }

                document.getElementById('booking-step-1').style.display = 'none';
                document.getElementById('booking-step-2').style.display = 'block';
            } catch(e) { alert("Error checking availability."); }
            btn.textContent = 'Check Availability';
        });

        document.getElementById('btn-submit-booking').addEventListener('click', async () => {
            if(!selectedTime) return alert("Please select an available time slot.");
            const payload = {
                serviceId: document.getElementById('b-service').value,
                dentistId: document.getElementById('b-dentist').value,
                date: document.getElementById('b-date').value,
                time: selectedTime,
                patientName: document.getElementById('b-name').value,
                email: document.getElementById('b-email').value,
                phone: document.getElementById('b-phone').value,
                reason: document.getElementById('b-reason').value
            };
            if(!payload.patientName || !payload.email || !payload.phone) return alert("Fill out your details.");

            const btn = document.getElementById('btn-submit-booking');
            btn.textContent = 'Processing...';

            try {
                const res = await fetch('/api/appointments', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if(data.error) throw new Error(data.error);

                document.getElementById('b-reference').textContent = data.reference;
                document.getElementById('booking-step-2').style.display = 'none';
                document.getElementById('booking-step-3').style.display = 'block';
            } catch(e) { alert(e.message); }
            btn.textContent = 'Confirm Booking';
        });
    </script>
</body>
</html>`;
    res.send(html);
});

// Start Server Wrapper (Local / Export for Vercel)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`PearlSmile backend active on http://localhost:${PORT}`));
}
module.exports = app;
