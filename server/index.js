require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const { verifyBinQrPayload } = require('./lib/binQr');
const {
    REWARD_MAP, REDEEM_CATALOG, planWasteDeposit, planRedemption,
    computeImpact, publicCatalog, generateVoucherCode, isValidUpiId,
    planRedemptionStatusChange, ADMIN_STATUSES,
} = require('./lib/rewards');
const { createProfileStore } = require('./lib/profileStore');

// Supabase verifies login tokens with WebCrypto; make sure it is available on every Node version.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

// ==========================================
// 0. CONFIGURATION (all secrets come from the environment)
// ==========================================

function intFromEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// --- Scan-session signing secret (bin scans only; user logins are handled by Supabase Auth) ---
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    if (JWT_SECRET) console.warn('⚠️  JWT_SECRET is shorter than 32 characters — ignoring it.');
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn('⚠️  JWT_SECRET not set: using a random per-process secret. In-progress bin scans are lost on restart.');
}
const JWT_ISSUER = 'naav-bins';
const SCAN_AUDIENCE = 'naav-bins-scan';

// --- Reward integrity ---
const QR_SECRET = process.env.QR_SECRET && process.env.QR_SECRET.length >= 32 ? process.env.QR_SECRET : null;
if (!QR_SECRET) console.warn('⚠️  QR_SECRET not set (min 32 chars): bin QR verification is disabled, so scanning will be rejected.');
const SCAN_SESSION_TTL = process.env.SCAN_SESSION_TTL || '5m';
const REWARD_COOLDOWN_MS = intFromEnv('REWARD_COOLDOWN_SECONDS', 30) * 1000;
const DAILY_ITEM_LIMIT = intFromEnv('DAILY_ITEM_LIMIT', 30);

// --- Supabase (database + authentication) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SECRET_KEY must be set. See server/.env.example');
    process.exit(1);
}

// --- CORS ---
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
const profiles = createProfileStore(supabase);
console.log('⚡ Supabase connected (database + authentication)');

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
        // Requests without an Origin header (curl, server-to-server) carry no browser credentials.
        if (!origin || !CORS_ORIGINS.length || CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
}));

app.use(express.json({ limit: '10kb' }));

// --- Helpers ---
function fail(res, code, message) {
    return res.status(code).json({ status: 'error', error: message, message });
}

const str = v => (typeof v === 'string' ? v.trim() : '');
const hasKey = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
const scanLimiter = rateLimit({ windowMs: MIN, max: 20, keyFn: req => `scan:${req.user.id}` });
const writeLimiter = rateLimit({ windowMs: MIN, max: 30, keyFn: req => `write:${req.user.id}` });

// ==========================================
// 3. AUTHENTICATION (SUPABASE AUTH)
// ==========================================
// Sign-up, login, social login, email verification and password reset all happen between the
// browser and Supabase Auth. The API only verifies the Supabase access token on each request
// (signature checked against the project's published signing keys, plus expiry).

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

// Loads the caller's profile (creating it if the sign-up trigger has not). Ends the session if the
// account was deleted.
async function loadProfile(req, res, next) {
    try {
        const profile = await profiles.ensureProfile(req.user);
        if (!profile) return fail(res, 401, 'This account no longer exists. Please sign in again.');
        req.profile = profile;
        next();
    } catch (err) {
        console.error('Profile load error:', err);
        return fail(res, 500, 'Server Error');
    }
}

// The role lives only in user_profiles.role and is read fresh on every admin request.
function requireAdmin(req, res, next) {
    if (!req.profile || req.profile.role !== 'admin') return fail(res, 403, 'Admin access required');
    next();
}

// ==========================================
// 4. ACCOUNT + SYSTEM DATA
// ==========================================

// Who am I? Used by the app after sign-in to decide between the user dashboard and the admin portal.
app.get('/api/me', verifyToken, loadProfile, (req, res) => {
    const { id, email, name, role } = req.profile;
    res.json({ status: 'ok', profile: { id, email, name, role } });
});

app.get('/api/dashboard', verifyToken, loadProfile, (req, res) => {
    res.json({ status: 'ok', user: req.profile, impact: computeImpact(req.profile.logs) });
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
            { sub: req.user.id, binId: String(bin.id), binName: bin.name },
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
    if (session.sub !== req.user.id || !session.jti) {
        return fail(res, 403, 'This bin scan belongs to a different account.');
    }
    if (!hasKey(REWARD_MAP, wasteType)) return fail(res, 400, 'Unknown waste type');

    try {
        const outcome = await profiles.atomicUpdate(req.user.id, user => planWasteDeposit(user, {
            wasteType,
            binName: session.binName,
            sessionId: session.jti,
            now: Date.now(),
            cooldownMs: REWARD_COOLDOWN_MS,
            dailyLimit: DAILY_ITEM_LIMIT,
        }));

        if (outcome.outcome === 'not_found') return fail(res, 404, 'Profile not found');
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
        const outcome = await profiles.atomicUpdate(req.user.id, user =>
            planRedemption(user, { item, upiId, code, now: Date.now() }));

        if (outcome.outcome === 'not_found') return fail(res, 404, 'Profile not found');
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
app.get('/api/admin/users', verifyToken, loadProfile, requireAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('user_profiles')
            .select('id, email, name, role, walletBalance, ecoPoints, logs, redemptions, createdAt')
            .order('createdAt', { ascending: true });
        if (error) throw error;

        const usersList = users.map(u => ({ ...u, _id: u.id, impact: computeImpact(u.logs) }));
        res.json({ status: 'ok', users: usersList });
    } catch (err) {
        console.error('Admin users error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// ADMIN: change a redemption's status (Pending -> Paid/Rejected, Issued -> Claimed/Cancelled).
// Rejected/Cancelled refund the cost to the user. Applied atomically.
app.post('/api/admin/redemptions/status', verifyToken, loadProfile, requireAdmin, writeLimiter, async (req, res) => {
    const userId = str(req.body && req.body.userId);
    const code = str(req.body && req.body.code);
    const status = req.body && req.body.status;

    if (!UUID_RE.test(userId) || !/^NB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) || !ADMIN_STATUSES.includes(status)) {
        return fail(res, 400, 'Invalid request');
    }

    try {
        const outcome = await profiles.atomicUpdate(userId, user =>
            planRedemptionStatusChange(user, { code, status, now: Date.now(), adminEmail: req.user.email }));

        if (outcome.outcome === 'not_found') return fail(res, 404, 'User not found');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.message);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'This account changed while saving. Please refresh and try again.');

        statsCache = null;
        res.json({ status: 'ok', redemption: outcome.result });
    } catch (err) {
        console.error('Redemption status error:', err);
        return fail(res, 500, 'Server Error');
    }
});

// PUBLIC IMPACT STATS (landing/about pages). Aggregates only; cached briefly.
const STATS_TTL_MS = 5 * MIN;
let statsCache = null;

app.get('/api/stats', async (req, res) => {
    try {
        if (!statsCache || statsCache.expires <= Date.now()) {
            const [{ data: users, error }, { data: bins, error: binsError }] = await Promise.all([
                supabase.from('user_profiles').select('logs, role'),
                supabase.from('bins').select('status'),
            ]);
            if (error) throw error;
            if (binsError) throw binsError;

            let items = 0, wasteKg = 0, co2Kg = 0, rewardsIssued = 0;
            for (const u of users) {
                const impact = computeImpact(u.logs);
                items += impact.items;
                wasteKg += impact.wasteKg;
                co2Kg += impact.co2Kg;
                for (const log of Array.isArray(u.logs) ? u.logs : []) rewardsIssued += Number(log && log.amount) || 0;
            }
            const round = n => Math.round(n * 1000) / 1000;
            statsCache = {
                expires: Date.now() + STATS_TTL_MS,
                value: {
                    users: users.filter(u => u.role !== 'admin').length,
                    items,
                    wasteKg: round(wasteKg),
                    co2Kg: round(co2Kg),
                    rewardsIssued,
                    bins: bins.length,
                    activeBins: bins.filter(b => b.status === 'Active').length,
                },
            };
        }
        res.json({ status: 'ok', ...statsCache.value });
    } catch (err) {
        console.error('Stats error:', err);
        return fail(res, 500, 'Could not fetch stats');
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
            .gt('ecoPoints', 0)
            .order('ecoPoints', { ascending: false })
            .limit(50);
        if (error) throw error;
        const leaderboard = leaders.map(l => ({ name: (l.name || '').trim() || 'Eco-warrior', ecoPoints: l.ecoPoints }));
        res.json({ status: 'ok', leaderboard });
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
app.listen(PORT, () => console.log(`✅ Naav Bins API running on port ${PORT}`));
