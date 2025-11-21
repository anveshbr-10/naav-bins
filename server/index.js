// server/index.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION

mongoose.connect('mongodb://127.0.0.1:27017/smartbin_db')
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// 2. USER MODEL (Schema)
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // 'user' or 'admin'
    walletBalance: { type: Number, default: 0 },
    ecoPoints: { type: Number, default: 0 },
    co2Saved: { type: Number, default: 0 },
    logs: [{ date: Date, wasteType: String, weight: Number, amount: Number }]
});
const User = mongoose.model('User', UserSchema);

// 3. ROUTES

// Register
app.post('/api/register', async (req, res) => {
    try {
        const newPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({
            name: req.body.name,
            email: req.body.email,
            password: newPassword,
        });
        res.json({ status: 'ok' });
    } catch (err) {
        res.json({ status: 'error', error: 'Duplicate Email' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.json({ status: 'error', user: false });

    const isValid = await bcrypt.compare(req.body.password, user.password);
    if (isValid) {
        const token = jwt.sign({ email: user.email, id: user._id }, 'secret123');
        return res.json({ status: 'ok', token: token, role: user.role });
    } else {
        return res.json({ status: 'error', user: false });
    }
});

// Get User Data
app.get('/api/dashboard', async (req, res) => {
    const token = req.headers['x-access-token'];
    try {
        const decoded = jwt.verify(token, 'secret123');
        const user = await User.findById(decoded.id);
        res.json({ status: 'ok', user: user });
    } catch (error) {
        res.json({ status: 'error', error: 'Invalid Token' });
    }
});

// Add Waste (The AI Trigger)
// server/index.js

app.post('/api/add-waste', async (req, res) => {
    const token = req.headers['x-access-token'];
    try {
        const decoded = jwt.verify(token, 'secret123');
        const user = await User.findById(decoded.id);
        
        const type = req.body.wasteType || 'Plastic'; // Get type from frontend
        
        // --- DYNAMIC REWARD LOGIC ---
        let reward = 0;
        let points = 0;

        if (type === 'Plastic') {
            reward = 10;   // Higher reward for Plastic
            points = 50;   // Higher points
        } else {
            reward = 7;    // Lower reward for Non-Plastic (Organic/Paper)
            points = 20;   // Lower points
        }
        // -----------------------------
        
        user.walletBalance += reward;
        user.ecoPoints += points;
        
        // Log it
        user.logs.push({ 
            date: new Date(), 
            wasteType: type, 
            weight: 0.5, 
            amount: reward 
        });
        
        await user.save();
        
        // Send the calculated reward back to frontend so we can show it
        res.json({ status: 'ok', rewardAdded: reward }); 
        
    } catch (error) {
        res.json({ status: 'error' });
    }
});

// Admin Route
app.get('/api/admin/users', async (req, res) => {
    const users = await User.find({});
    res.json({ status: 'ok', users: users });
});

app.listen(5000, () => console.log("✅ Server running on port 5000"));