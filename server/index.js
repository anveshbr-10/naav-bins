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

// 2. USER MODEL
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, 
    walletBalance: { type: Number, default: 0 }, 
    ecoPoints: { type: Number, default: 0 },     
    
    logs: [{ 
        date: { type: Date, default: Date.now }, 
        wasteType: String, 
        weight: Number, 
        amount: Number 
    }],
    
    redemptions: [{ 
        date: { type: Date, default: Date.now }, 
        item: String, 
        cost: Number, 
        type: String 
    }] 
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

// Dashboard Data
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

// Add Waste (Scanning) - Includes Logic for Plastic/Organic
app.post('/api/add-waste', async (req, res) => {
    const token = req.headers['x-access-token'];
    try {
        const decoded = jwt.verify(token, 'secret123');
        const user = await User.findById(decoded.id);
        
        const type = req.body.wasteType || 'Plastic'; 
        
        let reward = 0;
        let points = 0;

        if (type === 'Plastic') {
            reward = 10;
            points = 50;
        } else {
            reward = 7;
            points = 20;
        }
        
        // Math
        user.walletBalance += reward;
        user.ecoPoints += points;
        
        user.logs.push({ wasteType: type, weight: 0.5, amount: reward });
        
        await user.save();
        res.json({ status: 'ok', rewardAdded: reward }); 
    } catch (error) {
        res.json({ status: 'error' });
    }
});

// --- REDEMPTION ROUTE (DEBUGGED) ---
app.post('/api/redeem', async (req, res) => {
    const token = req.headers['x-access-token'];
    console.log("🔵 Redemption Request Received..."); // DEBUG LOG 1

    try {
        const decoded = jwt.verify(token, 'secret123');
        const user = await User.findById(decoded.id);
        
        // Force cost to be a Number
        const cost = Number(req.body.cost); 
        const { item, type } = req.body;

        console.log(`🔍 User: ${user.name} | Has: ₹${user.walletBalance} | Cost: ₹${cost}`); // DEBUG LOG 2

        if (type === 'money') {
            // Withdraw Logic
            if (user.walletBalance < cost) {
                console.log("❌ Insufficient Funds");
                return res.json({ status: 'error', message: 'Insufficient Funds' });
            }
            user.walletBalance = user.walletBalance - cost; // Explicit Subtraction
            console.log(`✅ New Balance: ${user.walletBalance}`);
        } else {
            // Points Logic
            if (user.ecoPoints < cost) {
                console.log("❌ Insufficient Points");
                return res.json({ status: 'error', message: 'Insufficient Points' });
            }
            user.ecoPoints = user.ecoPoints - cost; // Explicit Subtraction
        }

        user.redemptions.push({ item, cost, type });
        await user.save(); // SAVE TO DB

        console.log("✅ Database Updated Successfully");
        res.json({ status: 'ok' });
    } catch (error) {
        console.log("❌ ERROR:", error);
        res.json({ status: 'error', message: 'Server Error' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const users = await User.find({});
    res.json({ status: 'ok', users: users });
});

app.listen(5000, () => console.log("✅ Server running on port 5000"));