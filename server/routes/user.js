// Signed-in user endpoints: profile, dashboard, bin scans, deposits, redemptions, challenges.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { verifyBinQr } = require('../lib/binQr');
const { checkGeofence } = require('../lib/geo');
const { decodeThumbnail, perceptualHash } = require('../lib/imageHash');
const { planWasteDeposit, planRedemption, computeImpact, generateVoucherCode, isValidUpiId } = require('../lib/rewards');
const { istWeek, userStats, computeBadges, computeChallenges } = require('../lib/leagues');
const { getLeagues } = require('./public');

const PROFILE_FIELDS = ['id', 'email', 'name', 'role', 'department', 'hostel', 'is_blocked'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]));

module.exports = function userRoutes(ctx) {
    const { app, supabase, store, config, fail, str, verifyToken, loadProfile, limiters, caches } = ctx;

    // Who am I? Used after sign-in to choose between the dashboard, the console and the counter.
    app.get('/api/me', verifyToken, loadProfile, (req, res) => {
        res.json({ status: 'ok', profile: pick(req.profile, PROFILE_FIELDS) });
    });

    // Join a department and a hostel (for campus leagues), or change display name.
    app.post('/api/me/profile', verifyToken, loadProfile, limiters.write, async (req, res) => {
        const body = req.body || {};
        const changes = {};
        if ('name' in body) {
            const name = str(body.name).slice(0, 60);
            if (!name) return fail(res, 400, 'Please enter your name.');
            changes.name = name;
        }
        const wanted = ['department', 'hostel'].filter(k => k in body);
        if (wanted.length) {
            const { data: groups, error } = await supabase.from('campus_groups').select('id, kind').eq('active', true);
            if (error) throw error;
            for (const kind of wanted) {
                const value = body[kind] === null || body[kind] === '' ? null : str(body[kind]);
                if (value !== null && !groups.some(g => g.id === value && g.kind === kind)) return fail(res, 400, 'Please choose from the list.');
                changes[kind] = value;
            }
        }
        if (!Object.keys(changes).length) return fail(res, 400, 'Nothing to update.');
        const { data, error } = await supabase.from('user_profiles').update(changes).eq('id', req.user.id).select('*').maybeSingle();
        if (error) throw error;
        caches.leagues.clear();
        res.json({ status: 'ok', profile: pick(data, PROFILE_FIELDS) });
    });

    // Dashboard: balances, recent activity, redemptions, impact, streak, badges, weekly challenges, rank.
    app.get('/api/dashboard', verifyToken, loadProfile, async (req, res) => {
        const now = Date.now();
        const [logsRes, redemptionsRes, tables] = await Promise.all([
            supabase.from('waste_logs')
                .select('id, created_at, bin_id, bin_name, waste_type, stream, accepted, reject_reason, reward_inr, points, est_weight_kg, measured_weight_kg')
                .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(5000),
            supabase.from('redemptions').select('code, item, type, cost, status, upi_id, vendor, created_at, processed_at')
                .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50),
            store.loadRewardTables(),
        ]);
        if (logsRes.error) throw logsRes.error;
        if (redemptionsRes.error) throw redemptionsRes.error;
        const logs = logsRes.data || [];

        const week = istWeek(now);
        const weekLogs = logs.filter(l => Date.parse(l.created_at) >= week.startMs);
        const claimed = await store.claimedChallengeIds(req.user.id, week.key);
        const stats = userStats(logs, now);

        let rank = null;
        try {
            const leagues = await getLeagues(ctx, 'week');
            const me = leagues.individuals.find(r => r.userId === req.user.id);
            const dept = leagues.departments.find(r => r.id === req.profile.department);
            const hostel = leagues.hostels.find(r => r.id === req.profile.hostel);
            rank = {
                individual: me ? me.rank : null,
                individualOf: leagues.individuals.length,
                department: dept ? { rank: dept.rank, of: leagues.departments.length, points: dept.points } : null,
                hostel: hostel ? { rank: hostel.rank, of: leagues.hostels.length, points: hostel.points } : null,
            };
        } catch (err) {
            console.error('Rank error:', err.message || err);
        }

        const { walletBalance, ecoPoints, createdAt } = req.profile;
        res.json({
            status: 'ok',
            user: { ...pick(req.profile, PROFILE_FIELDS), walletBalance, ecoPoints, createdAt },
            logs: logs.slice(0, 50),
            redemptions: redemptionsRes.data || [],
            impact: computeImpact(logs, tables.rules),
            progress: {
                streak: stats.streak,
                badges: computeBadges(stats),
                ...computeChallenges(weekLogs, claimed, now),
                weekItems: weekLogs.filter(l => l.accepted !== false).length,
                weekPoints: weekLogs.reduce((s, l) => s + (l.accepted === false ? 0 : Number(l.points) || 0), 0),
                rank,
            },
        });
    });

    // Claim the bonus for a completed weekly challenge (once per challenge).
    app.post('/api/challenges/claim', verifyToken, loadProfile, limiters.write, async (req, res) => {
        const id = str(req.body && req.body.challengeId);
        const now = Date.now();
        const week = istWeek(now);
        const weekLogs = await store.logsSince(req.user.id, week.startMs);
        const { challenges } = computeChallenges(weekLogs, new Set(), now);
        const challenge = challenges.find(c => c.id === id);
        if (!challenge) return fail(res, 404, 'This challenge is not active this week.');
        if (!challenge.completed) return fail(res, 409, 'Complete the challenge first.');
        const result = await store.claimChallenge(req.user.id, challenge.id, challenge.bonus);
        if (result === 'already_claimed') return fail(res, 409, 'You have already claimed this bonus.');
        if (result !== 'ok') return fail(res, 404, 'Profile not found');
        res.json({ status: 'ok', pointsAdded: challenge.bonus });
    });

    // START A SCAN SESSION
    // 1. The QR must be a genuine signed code (printed, or the live rotating code on the bin's screen).
    // 2. The bin must be registered and active; dynamic-mode bins refuse printed copies.
    // 3. The phone must be at the bin (geofence).
    // Then a short-lived, single-use scan token is issued for one deposit.
    app.post('/api/scan/start', verifyToken, loadProfile, limiters.scan, async (req, res) => {
        if (!config.QR_SECRET) return fail(res, 503, 'Bin verification is not configured on the server.');
        if (req.profile.is_blocked) return fail(res, 403, 'Your account is paused from earning rewards. Please contact the campus team.');

        const userId = req.user.id;
        const qr = verifyBinQr(req.body && req.body.qr, config.QR_SECRET, { periodS: config.DYNAMIC_QR_PERIOD_S });
        if (!qr.ok) {
            if (qr.reason === 'forged') {
                store.recordFlag({ userId, binId: qr.binId, kind: 'forged_qr', severity: 'high', details: { qr: String(req.body.qr).slice(0, 120) } });
                return fail(res, 400, 'This QR code could not be verified. Please scan the code on a Naav Bins bin.');
            }
            if (qr.reason === 'expired') {
                store.recordFlag({ userId, binId: qr.binId, kind: 'expired_qr', severity: 'medium', details: {} });
                return fail(res, 400, 'This code has expired. Scan the live code on the bin\'s screen.');
            }
            return fail(res, 400, 'This is not a valid Naav Bins QR code.');
        }

        const { data: bin, error } = await supabase.from('bins')
            .select('id, name, lat, lng, status, stream, qr_mode, device_key_version')
            .eq('id', qr.binId).maybeSingle();
        if (error) throw error;
        if (!bin) {
            store.recordFlag({ userId, binId: qr.binId, kind: 'unknown_bin', severity: 'low', details: {} });
            return fail(res, 404, 'This bin is not registered.');
        }
        if (bin.status !== 'Active') return fail(res, 409, '{bin} is currently {status}. Please use an active bin.', { bin: bin.name, status: bin.status });

        if (qr.mode === 'static' && bin.qr_mode === 'dynamic') {
            store.recordFlag({ userId, binId: bin.id, kind: 'printed_code_on_live_bin', severity: 'medium', details: {} });
            return fail(res, 400, 'This bin shows a live QR code on its screen. Please scan that code.');
        }
        if (qr.mode === 'dynamic' && qr.keyVersion !== Number(bin.device_key_version || 1)) {
            store.recordFlag({ userId, binId: bin.id, kind: 'revoked_device_key', severity: 'high', details: { keyVersion: qr.keyVersion } });
            return fail(res, 400, 'This QR code could not be verified. Please scan the code on a Naav Bins bin.');
        }

        let gpsDistance = null;
        if (config.GEOFENCE_ENABLED) {
            const fence = checkGeofence(req.body && req.body.location, bin, {
                radiusM: config.GEOFENCE_RADIUS_M, maxAccuracyM: config.GEOFENCE_MAX_ACCURACY_M,
            });
            if (!fence.ok) {
                if (fence.reason === 'missing') return fail(res, 400, 'Please allow location access so we can confirm you are at the bin.');
                if (fence.reason === 'inaccurate') {
                    return fail(res, 400, 'Your location is not precise enough (±{accuracy} m). Step into the open for a few seconds and try again.', { accuracy: Math.round(fence.accuracy) });
                }
                store.recordFlag({ userId, binId: bin.id, kind: 'geofence', severity: fence.distance > 1000 ? 'high' : 'medium', details: { distance: fence.distance } });
                return fail(res, 403, 'You need to be at the bin to use it. You are about {distance} m away.', { distance: fence.distance });
            }
            gpsDistance = fence.distance;
        }

        const stream = ['station', 'dry', 'wet', 'reject'].includes(bin.stream) ? bin.stream : 'station';
        const scanToken = jwt.sign(
            { sub: userId, binId: String(bin.id), binName: bin.name, stream, gps: gpsDistance },
            config.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: config.SCAN_SESSION_TTL, issuer: config.JWT_ISSUER, audience: config.SCAN_AUDIENCE, jwtid: crypto.randomUUID() },
        );
        res.json({ status: 'ok', scanToken, bin: { id: bin.id, name: bin.name, stream } });
    });

    // ADD WASTE: needs a valid scan session and a thumbnail of the capture. The server hashes the
    // thumbnail, applies the per-bin cooldown, daily cap, duplicate-photo and stream checks, and
    // credits the reward from the database reward table — atomically.
    app.post('/api/add-waste', verifyToken, limiters.write, async (req, res) => {
        const body = req.body || {};
        let session;
        try {
            if (typeof body.scanToken !== 'string') throw new Error('missing');
            session = jwt.verify(body.scanToken, config.JWT_SECRET, {
                algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.SCAN_AUDIENCE,
            });
        } catch {
            return fail(res, 403, 'Bin scan expired or missing. Please scan the bin QR code again.');
        }
        if (session.sub !== req.user.id || !session.jti) return fail(res, 403, 'This bin scan belongs to a different account.');

        let tables;
        try {
            tables = await store.loadRewardTables();
        } catch (err) {
            console.error('Reward table error:', err);
            return fail(res, 503, 'Rewards are unavailable right now. Please try again shortly.');
        }
        const wasteType = body.wasteType;
        if (typeof wasteType !== 'string' || !Object.prototype.hasOwnProperty.call(tables.rules, wasteType)) {
            return fail(res, 400, 'Unknown waste type');
        }

        const pixels = decodeThumbnail(body.imageThumb);
        if (!pixels) return fail(res, 400, 'Could not read the photo. Please capture the item again.');
        const imageHash = perceptualHash(pixels);
        const previous = imageHash
            ? await store.previousHashes(req.user.id, session.binId, { userWindowMs: config.DUPLICATE_USER_WINDOW_MS, binWindowMs: config.DUPLICATE_BIN_WINDOW_MS })
            : [];

        const bin = { id: session.binId, name: session.binName, stream: session.stream };
        let flag = null;
        const outcome = await store.applyDeposit(req.user.id, (profile, recentLogs) => {
            if (profile.is_blocked) return { reject: { code: 403, message: 'Your account is paused from earning rewards. Please contact the campus team.', template: 'Your account is paused from earning rewards. Please contact the campus team.' } };
            const plan = planWasteDeposit(profile, recentLogs, {
                rules: tables.rules,
                wasteType,
                bin,
                sessionId: session.jti,
                now: Date.now(),
                cooldownMs: config.REWARD_COOLDOWN_MS,
                dailyLimit: config.DAILY_ITEM_LIMIT,
                imageHash,
                duplicates: { previous, threshold: config.PHASH_THRESHOLD, userId: req.user.id },
                gpsDistance: Number.isFinite(session.gps) ? session.gps : null,
            });
            if (plan.reject && plan.reject.flag) flag = plan.reject.flag;
            return plan;
        });

        if (outcome.outcome === 'rejected' && flag) store.recordFlag({ userId: req.user.id, binId: bin.id, ...flag });
        if (outcome.outcome === 'not_found') return fail(res, 404, 'Profile not found');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.template || outcome.message, outcome.params);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'Your account is busy. Please try again.');

        caches.stats = null;
        const r = outcome.result;
        res.json({
            status: 'ok',
            accepted: r.accepted,
            reason: r.reason || null,
            stream: r.stream,
            binStream: r.binStream,
            rewardAdded: r.reward,
            pointsAdded: r.points,
        });
    });

    // REDEEM: cost and type come from the database catalogue, never from the client.
    app.post('/api/redeem', verifyToken, loadProfile, limiters.write, async (req, res) => {
        const item = req.body && req.body.item;
        const upiId = req.body && req.body.upiId;
        const { catalog } = await store.loadRewardTables();
        const entry = typeof item === 'string' && Object.prototype.hasOwnProperty.call(catalog, item) ? catalog[item] : null;
        if (!entry) return fail(res, 400, 'Unknown reward item');
        if (entry.type === 'money' && !isValidUpiId(upiId)) return fail(res, 400, 'Please enter a valid UPI ID (e.g. name@bank).');

        const outcome = await store.applyRedemption(req.user.id, profile =>
            planRedemption(profile, { catalog, item, upiId, code: generateVoucherCode() }));
        if (outcome.outcome === 'not_found') return fail(res, 404, 'Profile not found');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.template || outcome.message, outcome.params);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'Your account is busy. Please try again.');
        res.json({ status: 'ok', redeemed: outcome.result });
    });
};
