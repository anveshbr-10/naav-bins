require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const { createStore } = require('./lib/store');
const { render } = require('./lib/rewards');

// Supabase verifies login tokens with WebCrypto; make sure it is available on every Node version.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

// ==========================================
// 0. CONFIGURATION (all secrets come from the environment)
// ==========================================

function intFromEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function numFromEnv(name, fallback) {
    const n = parseFloat(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}
function boolFromEnv(name, fallback) {
    const v = String(process.env[name] || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return fallback;
}

// Scan-session signing secret (bin scans only; user logins are handled by Supabase Auth).
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    if (JWT_SECRET) console.warn('⚠️  JWT_SECRET is shorter than 32 characters — ignoring it.');
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn('⚠️  JWT_SECRET not set: using a random per-process secret. In-progress bin scans are lost on restart.');
}

const QR_SECRET = process.env.QR_SECRET && process.env.QR_SECRET.length >= 32 ? process.env.QR_SECRET : null;
if (!QR_SECRET) console.warn('⚠️  QR_SECRET not set (min 32 chars): bin QR verification and bin devices are disabled.');

const config = {
    JWT_SECRET,
    JWT_ISSUER: 'naav-bins',
    SCAN_AUDIENCE: 'naav-bins-scan',
    QR_SECRET,
    SCAN_SESSION_TTL: process.env.SCAN_SESSION_TTL || '5m',
    // Rate limits: cooldown per user per bin, and a daily cap per user.
    REWARD_COOLDOWN_MS: intFromEnv('REWARD_COOLDOWN_SECONDS', 20) * 1000,
    DAILY_ITEM_LIMIT: intFromEnv('DAILY_ITEM_LIMIT', 30),
    // Geofence: the user's phone must be within ~GEOFENCE_RADIUS_M of the bin.
    GEOFENCE_ENABLED: boolFromEnv('GEOFENCE_ENABLED', true),
    GEOFENCE_RADIUS_M: intFromEnv('GEOFENCE_RADIUS_M', 50),
    GEOFENCE_MAX_ACCURACY_M: intFromEnv('GEOFENCE_MAX_ACCURACY_M', 100),
    // Duplicate-photo check (perceptual hash, Hamming distance out of 64 bits).
    PHASH_THRESHOLD: intFromEnv('PHASH_THRESHOLD', 6),
    DUPLICATE_USER_WINDOW_MS: intFromEnv('DUPLICATE_WINDOW_DAYS', 30) * 24 * 60 * 60 * 1000,
    DUPLICATE_BIN_WINDOW_MS: intFromEnv('DUPLICATE_BIN_WINDOW_HOURS', 24) * 60 * 60 * 1000,
    // Rotating QR codes on bin screens.
    DYNAMIC_QR_PERIOD_S: Math.max(10, intFromEnv('DYNAMIC_QR_PERIOD_SECONDS', 30)),
    // Start point of the collection route (e.g. the waste yard). Defaults to the first bin due.
    DEPOT: Number.isFinite(numFromEnv('DEPOT_LAT', NaN)) && Number.isFinite(numFromEnv('DEPOT_LNG', NaN))
        ? { lat: numFromEnv('DEPOT_LAT', 0), lng: numFromEnv('DEPOT_LNG', 0) } : null,
};
if (!config.GEOFENCE_ENABLED) console.warn('⚠️  GEOFENCE_ENABLED=false: users can scan bins from anywhere.');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SECRET_KEY must be set. See server/.env.example');
    process.exit(1);
}

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
if (!CORS_ORIGINS.length) console.warn('⚠️  CORS_ORIGINS not set: API accepts requests from any website origin.');

// ==========================================
// 1. CONNECTIONS
// ==========================================

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const store = createStore(supabase);
console.log('⚡ Supabase connected (database + authentication)');

// Read-only check that supabase/002_operations.sql has been applied; without it most endpoints fail.
Promise.all([
    supabase.from('waste_logs').select('id').limit(1),
    supabase.from('reward_rules').select('waste_type').limit(1),
    supabase.from('bins').select('qr_mode').limit(1),
]).then((results) => {
    const failed = results.find(r => r.error);
    if (failed) {
        console.error(`❌ Database schema is out of date (${failed.error.message}).\n   Run server/supabase/002_operations.sql in the Supabase SQL Editor, then restart the API.`);
    }
}).catch(() => { /* network issue: requests will report it */ });

// ==========================================
// 2. APP + MIDDLEWARE
// ==========================================

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits behind one proxy; needed for correct client IPs

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
        // Requests without an Origin header (curl, bin devices) carry no browser credentials.
        if (!origin || !CORS_ORIGINS.length || CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Bin-Id', 'X-Device-Key'],
    maxAge: 600,
}));

app.use(express.json({ limit: '16kb' }));

// Errors carry the English template and its parameters, so the web app can translate them.
function fail(res, code, template, params) {
    const message = render(template, params);
    return res.status(code).json({ status: 'error', error: message, message, i18n: { key: template, params: params || null } });
}

function rateLimit({ windowMs, max, keyFn }) {
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
            return fail(res, 429, 'Too many requests. Please try again later.');
        }
        next();
    };
}

// --- Authentication (Supabase Auth) ---
// Sign-up, login, social login, email verification and password reset happen between the browser
// and Supabase Auth. The API verifies the Supabase access token on each request.
const str = v => (typeof v === 'string' ? v.trim() : '');

async function verifyToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return fail(res, 401, 'Please sign in.');
    try {
        const { data, error } = await supabase.auth.getClaims(token);
        const claims = data && data.claims;
        if (error || !claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') {
            return fail(res, 401, 'Your session has expired. Please sign in again.');
        }
        const meta = claims.user_metadata || {};
        req.user = {
            id: claims.sub,
            email: typeof claims.email === 'string' ? claims.email : '',
            name: str(meta.name) || str(meta.full_name),
        };
        next();
    } catch {
        return fail(res, 401, 'Your session has expired. Please sign in again.');
    }
}

// Loads the caller's profile (creating it if the sign-up trigger has not).
async function loadProfile(req, res, next) {
    const profile = await store.ensureProfile(req.user);
    if (!profile) return fail(res, 401, 'This account no longer exists. Please sign in again.');
    req.profile = profile;
    next();
}

// Roles live only in user_profiles.role and are read fresh on every request.
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.profile || !roles.includes(req.profile.role)) return fail(res, 403, 'Admin access required');
        next();
    };
}

const MIN = 60 * 1000;
const ctx = {
    app, supabase, store, config, fail, str,
    verifyToken, loadProfile, requireAdmin: requireRole('admin'), requireCounter: requireRole('admin', 'vendor'),
    limiters: {
        scan: rateLimit({ windowMs: MIN, max: 20, keyFn: req => `scan:${req.user.id}` }),
        write: rateLimit({ windowMs: MIN, max: 30, keyFn: req => `write:${req.user.id}` }),
        device: rateLimit({ windowMs: MIN, max: 120, keyFn: req => `device:${req.get('x-bin-id') || req.ip}` }),
    },
    // Short-lived caches that writes can clear.
    caches: { stats: null, leagues: new Map() },
};

// ==========================================
// 3. ROUTES
// ==========================================

require('./routes/public')(ctx);
require('./routes/user')(ctx);
require('./routes/admin')(ctx);
require('./routes/device')(ctx);

// ==========================================
// 4. FALLBACKS
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
app.listen(PORT, () => console.log(`✅ Naav Bins API running on port ${PORT}`));
