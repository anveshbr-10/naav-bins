require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const { verifyBinQrPayload } = require('./lib/binQr');
const {
    REWARD_MAP, REDEEM_CATALOG, planWasteDeposit, planRedemption,
    computeImpact, publicCatalog, generateVoucherCode, isValidUpiId,
} = require('./lib/rewards');
const { createProfileStore } = require('./lib/profileStore');

// ==========================================
// 0. CONFIGURATION (all secrets come from the environment)
// ==========================================

function intFromEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// --- JWT secret (S1) ---
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    if (JWT_SECRET) console.warn('⚠️  JWT_SECRET is shorter than 32 characters — ignoring it.');
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn('⚠️  JWT_SECRET not set: using a random per-process secret. Users will be logged out on every restart. Set JWT_SECRET in the environment.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_ISSUER = 'naav-bins';
const AUTH_AUDIENCE = 'naav-bins-app';
const SCAN_AUDIENCE = 'naav-bins-scan';

// --- Reward integrity (S4/S5/S6) ---
const QR_SECRET = process.env.QR_SECRET && process.env.QR_SECRET.length >= 32 ? process.env.QR_SECRET : null;
if (!QR_SECRET) console.warn('⚠️  QR_SECRET not set (min 32 chars): bin QR verification is disabled, so scanning will be rejected.');
const SCAN_SESSION_TTL = process.env.SCAN_SESSION_TTL || '5m';
const REWARD_COOLDOWN_MS = intFromEnv('REWARD_COOLDOWN_SECONDS', 30) * 1000;
const DAILY_ITEM_LIMIT = intFromEnv('DAILY_ITEM_LIMIT', 30);

// --- Supabase (S9) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = SUPABASE_SERVER_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_ANON_KEY) must be set. See server/.env.example');
    process.exit(1);
}
if (!SUPABASE_SERVER_KEY) {
    console.warn('⚠️  Using the PUBLIC Supabase key. Set SUPABASE_SECRET_KEY and enable RLS (server/supabase/security.sql) so the database cannot be accessed directly.');
}

// --- CORS (S12) ---
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
if (!CORS_ORIGINS.length) console.warn('⚠️  CORS_ORIGINS not set: API accepts requests from any website origin.');

// ==========================================
// 1. CONNECTIONS
// ==========================================

let serviceAccount;
if (process.env.FIREBASE_CREDS) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDS);
    } catch {
        console.error('❌ FIREBASE_CREDS is not valid JSON.');
        process.exit(1);
    }
    console.log('☁️  Running in Cloud Mode');
} else {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('💻 Running in Local Mode');
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log('🔥 Firebase Auth Connected');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});
const profiles = createProfileStore(supabase);
console.log('⚡ Supabase Database Connected');

// ==========================================
// 2. APP + MIDDLEWARE
// ==========================================

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits behind one proxy; needed for correct client IPs in rate limiting

app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
    });
    next();
});

app.use(cors({
    origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server, same-origin) carry no browser credentials.
        if (!origin || !CORS_ORIGINS.length || CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-access-token'],
    maxAge: 600,
}));

app.use(express.json({ limit: '10kb' }));

// --- Helpers ---
function fail(res, code, message) {
    // `error` and `message` are both kept for compatibility with existing clients.
    return res.status(code).json({ status: 'error', error: message, message });
}

const EMAIL_RE = /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[^\s@/]{2,63}$/;
const str = v => (typeof v === 'string' ? v.trim() : '');
const hasKey = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

function rateLimit({ windowMs, max, keyFn, message }) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
    }, windowMs).unref();

    return (req, res, next) => {
        const key = keyFn(req);
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;
        if (entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
            return fail(res, 429, message || 'Too many requests. Please try again later.');
        }
        next();
    };
}

const MIN = 60 * 1000;
const loginLimiterPerAccount = rateLimit({
    windowMs: 15 * MIN, max: 10,
    keyFn: req => `login:${req.ip}:${str(req.body && req.body.email).toLowerCase()}`,
    message: 'Too many login attempts. Please wait 15 minutes and try again.',
});
const loginLimiterPerIp = rateLimit({ windowMs: 15 * MIN, max: 100, keyFn: req => `login-ip:${req.ip}` });
const registerLimiter = rateLimit({
    windowMs: 60 * MIN, max: 30, keyFn: req => `register:${req.ip}`,
    message: 'Too many sign-ups from this network. Please try again later.',
});
const scanLimiter = rateLimit({ windowMs: MIN, max: 20, keyFn: req => `scan:${req.userEmail}` });
const writeLimiter = rateLimit({ windowMs: MIN, max: 30, keyFn: req => `write:${req.userEmail}` });

function verifyToken(req, res, next) {
    const token = req.headers['x-access-token'];
    if (!token || typeof token !== 'string') return fail(res, 401, 'No token provided');
    try {
        const decoded = jwt.verify(token, JWT_SECRET, {
            algorithms: ['HS256'], issuer: JWT_ISSUER, audience: AUTH_AUDIENCE,
        });
        if (typeof decoded.email !== 'string') throw new Error('bad payload');
        req.userEmail = decoded.email;
        next();
    } catch {
        return fail(res, 401, 'Invalid or expired token');
    }
}

// Role is re-checked against the auth database on every request, so demoting an admin takes effect immediately.
async function requireAdmin(req, res, next) {
    try {
        const doc = await db.collection('users').doc(req.userEmail).get();
        if (!doc.exists || doc.data().role !== 'admin') return fail(res, 403, 'Admin access required');
        next();
    } catch (err) {
        console.error('Admin check failed:', err);
        return fail(res, 500, 'Server Error');
    }
}

// Used to keep login timing identical whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// ==========================================
// 3. AUTHENTICATION (FIREBASE PRIMARY)
// ==========================================

app.post('/api/register', registerLimiter, async (req, res) => {
    const name = str(req.body && req.body.name);
    const email = str(req.body && req.body.email);
    const password = req.body && req.body.password;

    if (name.length < 1 || name.length > 60) return fail(res, 400, 'Please enter your name (max 60 characters).');
    if (email.length > 254 || !EMAIL_RE.test(email)) return fail(res, 400, 'Please enter a valid email address.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return fail(res, 400, 'Password must be between 8 and 72 characters.');
    }

    const userRef = db.collection('users').doc(email);
    try {
        const passwordHash = await bcrypt.hash(password, 10);

        // create() fails atomically if the document already exists (no check-then-write race).
        try {
            await userRef.create({ email, password: passwordHash, role: 'user' });
        } catch (err) {
            if (err && (err.code === 6 || /already exists/i.test(err.message || ''))) {
                return fail(res, 409, 'Email already exists');
            }
            throw err;
        }

        const { error: profileError } = await supabase.from('user_profiles').insert([{
            email, name, walletBalance: 0, ecoPoints: 0, logs: [], redemptions: [], role: 'user',
        }]);

        if (profileError) {
            console.error('Profile creation failed, rolling back auth record:', profileError);
            await userRef.delete().catch(e => console.error('Rollback failed:', e));
            return fail(res, 500, 'Could not create your profile. Please try again.');
        }

        res.status(201).json({ status: 'ok' });
    } catch (err) {
        console.error('Register error:', err);
        return fail(res, 500, 'Server Error');
    }
});

app.post('/api/login', loginLimiterPerIp, loginLimiterPerAccount, async (req, res) => {
    const email = str(req.body && req.body.email);
    const password = req.body && req.body.password;

    if (!email || email.length > 254 || email.includes('/') || typeof password !== 'string' || password.length > 128) {
        return fail(res, 401, 'Invalid email or password');
    }

    try {
        const doc = await db.collection('users').doc(email).get();
        const userData = doc.exists ? doc.data() : null;

        const isValid = await bcrypt.compare(password, userData ? userData.password : DUMMY_HASH);
        if (!userData || !isValid) return fail(res, 401, 'Invalid email or password');

        const role = userData.role === 'admin' ? 'admin' : 'user';
        const token = jwt.sign({ email: userData.email, role }, JWT_SECRET, {
            algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER, audience: AUTH_AUDIENCE,
        });
        return res.json({ status: 'ok', token, role });
    } catch (err) {
        console.error('Login error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// ==========================================
// 4. SYSTEM DATA (SUPABASE PRIMARY)
// ==========================================

app.get('/api/dashboard', verifyToken, async (req, res) => {
    try {
        const user = await profiles.getProfile(req.userEmail);
        if (!user) return fail(res, 404, 'User not found in database');
        res.json({ status: 'ok', user, impact: computeImpact(user.logs) });
    } catch (err) {
        console.error('Dashboard error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// START A SCAN SESSION: verifies the signed bin QR and returns a short-lived, single-use scan token.
app.post('/api/scan/start', verifyToken, scanLimiter, async (req, res) => {
    if (!QR_SECRET) return fail(res, 503, 'Bin verification is not configured on the server.');

    const binId = verifyBinQrPayload(req.body && req.body.qr, QR_SECRET);
    if (!binId) return fail(res, 400, 'This is not a valid Smart Bin QR code.');

    try {
        const { data: bin, error } = await supabase
            .from('bins')
            .select('id, name, status')
            .eq('id', binId)
            .maybeSingle();
        if (error) throw error;
        if (!bin) return fail(res, 404, 'This bin is not registered.');
        if (bin.status !== 'Active') return fail(res, 409, `${bin.name} is currently ${bin.status}. Please use an active bin.`);

        const scanToken = jwt.sign(
            { email: req.userEmail, binId: String(bin.id), binName: bin.name },
            JWT_SECRET,
            {
                algorithm: 'HS256', expiresIn: SCAN_SESSION_TTL, issuer: JWT_ISSUER,
                audience: SCAN_AUDIENCE, jwtid: crypto.randomUUID(),
            },
        );
        res.json({ status: 'ok', scanToken, bin: { id: bin.id, name: bin.name } });
    } catch (err) {
        console.error('Scan start error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// ADD WASTE: requires a valid scan session; reward is decided server-side and applied atomically.
app.post('/api/add-waste', verifyToken, writeLimiter, async (req, res) => {
    const scanToken = req.body && req.body.scanToken;
    const wasteType = req.body && req.body.wasteType;

    let session;
    try {
        if (typeof scanToken !== 'string') throw new Error('missing');
        session = jwt.verify(scanToken, JWT_SECRET, {
            algorithms: ['HS256'], issuer: JWT_ISSUER, audience: SCAN_AUDIENCE,
        });
    } catch {
        return fail(res, 403, 'Bin scan expired or missing. Please scan the bin QR code again.');
    }
    if (session.email !== req.userEmail || !session.jti) {
        return fail(res, 403, 'This bin scan belongs to a different account.');
    }
    if (!hasKey(REWARD_MAP, wasteType)) return fail(res, 400, 'Unknown waste type');

    try {
        const outcome = await profiles.atomicUpdate(req.userEmail, user => planWasteDeposit(user, {
            wasteType,
            binName: session.binName,
            sessionId: session.jti,
            now: Date.now(),
            cooldownMs: REWARD_COOLDOWN_MS,
            dailyLimit: DAILY_ITEM_LIMIT,
        }));

        if (outcome.outcome === 'not_found') return fail(res, 404, 'User not found in database');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.message);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'Your account is busy. Please try again.');

        res.json({ status: 'ok', rewardAdded: outcome.result.reward, pointsAdded: outcome.result.points });
    } catch (err) {
        console.error('Add waste error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// REDEEM: cost and type come from the server catalogue, never from the client.
app.post('/api/redeem', verifyToken, writeLimiter, async (req, res) => {
    const item = req.body && req.body.item;
    const upiId = req.body && req.body.upiId;
    if (!hasKey(REDEEM_CATALOG, item)) return fail(res, 400, 'Unknown reward item');
    if (REDEEM_CATALOG[item].type === 'money' && !isValidUpiId(upiId)) {
        return fail(res, 400, 'Please enter a valid UPI ID (e.g. name@bank).');
    }
    try {
        const code = generateVoucherCode();
        const outcome = await profiles.atomicUpdate(req.userEmail, user =>
            planRedemption(user, { item, upiId, code, now: Date.now() }));

        if (outcome.outcome === 'not_found') return fail(res, 404, 'User not found in database');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.message);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'Your account is busy. Please try again.');

        res.json({ status: 'ok', redeemed: outcome.result });
    } catch (err) {
        console.error('Redeem error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// REWARDS CATALOGUE (public): single source of truth for reward amounts and redeemable items.
app.get('/api/rewards/catalog', (req, res) => {
    res.json({ status: 'ok', ...publicCatalog() });
});

// ADMIN: GET ALL USERS — admins only.
app.get('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('user_profiles')
            .select('email, name, role, walletBalance, ecoPoints, logs, redemptions');
        if (error) throw error;

        const usersList = users.map(u => ({ ...u, _id: u.email }));
        res.json({ status: 'ok', users: usersList });
    } catch (err) {
        console.error('Admin users error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// GET BINS (public: locations and status only)
app.get('/api/bins', async (req, res) => {
    try {
        const { data: bins, error } = await supabase.from('bins').select('id, name, lat, lng, status');
        if (error) throw error;
        res.json({ status: 'ok', bins });
    } catch (err) {
        console.error('Bins error:', err);
        return fail(res, 500, 'Could not fetch bins');
    }
});

// LEADERBOARD (public: names and points only)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: leaders, error } = await supabase
            .from('user_profiles')
            .select('name, ecoPoints')
            .eq('role', 'user')
            .order('ecoPoints', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json({ status: 'ok', leaderboard: leaders });
    } catch (err) {
        console.error('Leaderboard error:', err);
        return fail(res, 500, 'Could not fetch leaderboard');
    }
});

// ==========================================
// 5. FALLBACKS
// ==========================================

app.use('/api', (req, res) => fail(res, 404, 'Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'Request too large');
    if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON body');
    console.error('Unhandled error:', err);
    return fail(res, 500, 'Server Error');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT} (Hybrid Auth/DB Mode)`));
