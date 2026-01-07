const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

// --- SMART FIREBASE CONNECTION ---
let serviceAccount;

if (process.env.FIREBASE_CREDS) {
    // OPTION A: CLOUD MODE (Render)
    // We will paste the JSON text into a secure variable called "FIREBASE_CREDS" on Render.
    // The server parses that text back into an object.
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDS);
    console.log("☁️  Running in Cloud Mode");
} else {
    // OPTION B: LOCAL MODE (Your Laptop)
    // We just read the file sitting in the folder.
    serviceAccount = require('./serviceAccountKey.json');
    console.log("💻 Running in Local Mode");
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());
// ----------------------------------

console.log("🔥 Firebase Firestore Connected");

// --- HELPER FUNCTIONS ---

// Middleware to verify JWT Token
const verifyToken = (req, res, next) => {
    const token = req.headers['x-access-token'];
    if (!token) return res.json({ status: 'error', error: 'No token provided' });

    try {
        const decoded = jwt.verify(token, 'secret123');
        req.userEmail = decoded.email; // We use Email as the ID in Firestore
        next();
    } catch (error) {
        return res.json({ status: 'error', error: 'Invalid Token' });
    }
};

// 2. ROUTES

// REGISTER (Create a document in 'users' collection)
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check if user exists
        const userRef = db.collection('users').doc(email);
        const doc = await userRef.get();

        if (doc.exists) {
            return res.json({ status: 'error', error: 'Email already exists' });
        }

        const newPassword = await bcrypt.hash(password, 10);

        // Create new user document
        await userRef.set({
            name: name,
            email: email,
            password: newPassword,
            role: 'user',
            walletBalance: 0,
            ecoPoints: 0,
            logs: [],
            redemptions: [],
            createdAt: new Date().toISOString()
        });

        res.json({ status: 'ok' });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Server Error' });
    }
});

// LOGIN (Read document from 'users' collection)
app.post('/api/login', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.body.email);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.json({ status: 'error', user: false });
        }

        const userData = doc.data();
        const isValid = await bcrypt.compare(req.body.password, userData.password);

        if (isValid) {
            // Generate Token using Email as ID
            const token = jwt.sign({ email: userData.email, role: userData.role }, 'secret123');
            return res.json({ status: 'ok', token: token, role: userData.role });
        } else {
            return res.json({ status: 'error', user: false });
        }
    } catch (err) {
        res.json({ status: 'error', error: err.message });
    }
});

// DASHBOARD (Fetch User Data)
app.get('/api/dashboard', verifyToken, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.userEmail);
        const doc = await userRef.get();

        if (!doc.exists) return res.json({ status: 'error', error: 'User not found' });

        res.json({ status: 'ok', user: doc.data() });
    } catch (error) {
        res.json({ status: 'error', error: 'Server Error' });
    }
});

// ADD WASTE (Update Wallet & Arrays)
app.post('/api/add-waste', verifyToken, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.userEmail);
        const doc = await userRef.get();
        const userData = doc.data();

        const type = req.body.wasteType || 'Plastic';

        let reward = (type === 'Plastic') ? 10 : 7;
        let points = (type === 'Plastic') ? 50 : 20;

        // Create the Log Object
        const newLog = {
            date: new Date().toISOString(),
            wasteType: type,
            weight: 0.5,
            amount: reward
        };

        // ATOMIC UPDATE (Safe math for Firestore)
        await userRef.update({
            walletBalance: admin.firestore.FieldValue.increment(reward),
            ecoPoints: admin.firestore.FieldValue.increment(points),
            logs: admin.firestore.FieldValue.arrayUnion(newLog)
        });

        res.json({ status: 'ok', rewardAdded: reward });

    } catch (error) {
        console.log(error);
        res.json({ status: 'error' });
    }
});

// REDEEM (Update Wallet & Arrays)
app.post('/api/redeem', verifyToken, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.userEmail);
        const doc = await userRef.get();
        const userData = doc.data();

        const cost = Number(req.body.cost);
        const { item, type } = req.body;

        if (type === 'money') {
            if (userData.walletBalance < cost) return res.json({ status: 'error', message: 'Insufficient Funds' });

            await userRef.update({
                walletBalance: admin.firestore.FieldValue.increment(-cost) // Negative increment = Subtraction
            });
        } else {
            if (userData.ecoPoints < cost) return res.json({ status: 'error', message: 'Insufficient Points' });

            await userRef.update({
                ecoPoints: admin.firestore.FieldValue.increment(-cost)
            });
        }

        const newRedemption = {
            date: new Date().toISOString(),
            item,
            cost,
            type
        };

        await userRef.update({
            redemptions: admin.firestore.FieldValue.arrayUnion(newRedemption)
        });

        res.json({ status: 'ok' });
    } catch (error) {
        console.log(error);
        res.json({ status: 'error', message: 'Server Error' });
    }
});

// ADMIN: GET ALL USERS
app.get('/api/admin/users', async (req, res) => {
    try {
        const usersSnapshot = await db.collection('users').get();
        const usersList = [];

        usersSnapshot.forEach(doc => {
            // We include the doc ID (email) as _id so the Frontend Key doesn't break
            usersList.push({ ...doc.data(), _id: doc.id });
        });

        res.json({ status: 'ok', users: usersList });
    } catch (err) {
        res.json({ status: 'error' });
    }
});

app.listen(5000, () => console.log("✅ Server running on port 5000 (Firebase Mode)"));