// Database access (Supabase, secret key). Every balance change goes through a transactional SQL
// function (see supabase/002_operations.sql):
//   naav_apply_deposit / naav_apply_redemption insert the log or redemption AND change the balance in
//   one transaction, guarded by compare-and-swap on the balances that were read. If another request
//   changed the balances in between, the function returns 'conflict' and we re-read and re-decide —
//   so concurrent requests cannot both pass the cooldown / daily-limit checks or double-spend.

const { normalizeRules, normalizeCatalog } = require('./rewards');

const LOG_FIELDS = 'id, created_at, bin_id, bin_name, waste_type, stream, accepted, reject_reason, reward_inr, points, est_weight_kg, measured_weight_kg, session_id';
const RULES_TTL_MS = 60 * 1000;
const FLAG_DEDUPE_MS = 10 * 60 * 1000;

function createStore(supabase, { now = () => Date.now() } = {}) {
    // ---------- profiles ----------
    async function getProfile(id) {
        const { data, error } = await supabase.from('user_profiles').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    }

    // The sign-up trigger normally creates the profile in the same transaction as the auth user.
    // This is a safety net. Returns null when the auth user no longer exists.
    async function ensureProfile({ id, email, name }) {
        const existing = await getProfile(id);
        if (existing) return existing;
        const { error } = await supabase.from('user_profiles').insert([{
            id,
            email,
            name: String(name || String(email || '').split('@')[0] || '').trim().slice(0, 60),
        }]);
        if (error && error.code === '23503') return null; // auth user deleted (foreign key)
        if (error && error.code !== '23505') throw error;  // 23505: created concurrently — fine
        return getProfile(id);
    }

    // ---------- reward table (cached briefly; the database is the source of truth) ----------
    let rulesCache = null;
    async function loadRewardTables() {
        if (rulesCache && rulesCache.expires > now()) return rulesCache.value;
        const [rules, catalog] = await Promise.all([
            supabase.from('reward_rules').select('*').order('sort'),
            supabase.from('reward_catalog').select('*, vendors(active)').order('sort'),
        ]);
        if (rules.error) throw rules.error;
        if (catalog.error) throw catalog.error;
        const value = {
            rules: normalizeRules(rules.data),
            catalog: normalizeCatalog(catalog.data),
            ruleRows: rules.data,
            catalogRows: catalog.data,
        };
        rulesCache = { value, expires: now() + RULES_TTL_MS };
        return value;
    }
    function invalidateRewardTables() { rulesCache = null; }

    // ---------- logs ----------
    async function logsSince(userId, sinceMs, fields = LOG_FIELDS) {
        const { data, error } = await supabase
            .from('waste_logs').select(fields)
            .eq('user_id', userId)
            .gte('created_at', new Date(sinceMs).toISOString())
            .order('created_at', { ascending: false })
            .limit(1000);
        if (error) throw error;
        return data || [];
    }

    // Earlier captures to compare a new photo with: this user's recent ones, and anyone's at this bin.
    async function previousHashes(userId, binId, { userWindowMs, binWindowMs }) {
        const t = now();
        const [mine, here] = await Promise.all([
            supabase.from('waste_logs').select('id, user_id, image_hash, created_at')
                .eq('user_id', userId).gte('created_at', new Date(t - userWindowMs).toISOString())
                .not('image_hash', 'is', null).limit(1000),
            supabase.from('waste_logs').select('id, user_id, image_hash, created_at')
                .eq('bin_id', String(binId)).gte('created_at', new Date(t - binWindowMs).toISOString())
                .not('image_hash', 'is', null).limit(1000),
        ]);
        if (mine.error) throw mine.error;
        if (here.error) throw here.error;
        const seen = new Set();
        return [...(mine.data || []), ...(here.data || [])].filter(r => !seen.has(r.id) && seen.add(r.id));
    }

    // decide(profile, recentLogs) -> { reject } | { log, result, expected? }
    async function applyDeposit(userId, decide, { windowMs = 24 * 60 * 60 * 1000, maxAttempts = 4 } = {}) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const [profile, recent] = await Promise.all([getProfile(userId), logsSince(userId, now() - windowMs)]);
            if (!profile) return { outcome: 'not_found' };
            const plan = decide(profile, recent);
            if (plan.reject) return { outcome: 'rejected', ...plan.reject };

            if (!plan.log.accepted) {
                // Wrong stream: recorded for contamination stats, no reward, no balance change.
                const { error } = await supabase.from('waste_logs').insert([{ user_id: userId, ...plan.log }]);
                if (error) throw error;
                return { outcome: 'ok', result: plan.result };
            }

            const { data, error } = await supabase.rpc('naav_apply_deposit', {
                p_user: userId,
                p_expected_wallet: profile.walletBalance,
                p_expected_points: profile.ecoPoints,
                p_log: plan.log,
            });
            if (error) throw error;
            if (data === 'ok') return { outcome: 'ok', result: plan.result };
            if (data === 'duplicate_session') {
                return { outcome: 'rejected', code: 409, message: 'This bin scan has already been used. Please scan the bin QR code again.', template: 'This bin scan has already been used. Please scan the bin QR code again.' };
            }
            // 'conflict': balances changed underneath us — re-read and re-decide.
        }
        return { outcome: 'conflict' };
    }

    // decide(profile) -> { reject } | { redemption, result }
    async function applyRedemption(userId, decide, { maxAttempts = 4 } = {}) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const profile = await getProfile(userId);
            if (!profile) return { outcome: 'not_found' };
            const plan = decide(profile);
            if (plan.reject) return { outcome: 'rejected', ...plan.reject };

            const { data, error } = await supabase.rpc('naav_apply_redemption', {
                p_user: userId,
                p_expected_wallet: profile.walletBalance,
                p_expected_points: profile.ecoPoints,
                p_redemption: plan.redemption,
            });
            if (error) throw error;
            if (data === 'ok') return { outcome: 'ok', result: plan.result };
            if (data === 'invalid') return { outcome: 'rejected', code: 400, message: 'Unknown reward item', template: 'Unknown reward item' };
            // 'conflict' or 'duplicate_code' (decide makes a fresh code on the next attempt): retry.
        }
        return { outcome: 'conflict' };
    }

    async function getRedemption(code) {
        const { data, error } = await supabase.from('redemptions').select('*').eq('code', code).maybeSingle();
        if (error) throw error;
        return data;
    }

    // plan(redemption) -> { reject } | { from, to, refund }
    async function changeRedemptionStatus(code, plan, actor) {
        const redemption = await getRedemption(code);
        if (!redemption) return { outcome: 'not_found' };
        const decision = plan(redemption);
        if (decision.reject) return { outcome: 'rejected', ...decision.reject };
        const { data, error } = await supabase.rpc('naav_set_redemption_status', {
            p_code: code, p_from: decision.from, p_to: decision.to, p_refund: decision.refund, p_actor: actor,
        });
        if (error) throw error;
        if (data !== 'ok') return { outcome: 'conflict' };
        return { outcome: 'ok', result: { ...redemption, status: decision.to, processed_by: actor, processed_at: new Date(now()).toISOString() } };
    }

    async function claimChallenge(userId, challengeId, points) {
        const { data, error } = await supabase.rpc('naav_claim_challenge', { p_user: userId, p_challenge: challengeId, p_points: points });
        if (error) throw error;
        return data; // 'ok' | 'already_claimed' | 'not_found' | 'invalid'
    }

    async function claimedChallengeIds(userId, weekKey) {
        const { data, error } = await supabase.from('challenge_claims').select('challenge_id')
            .eq('user_id', userId).like('challenge_id', `${weekKey}:%`);
        if (error) throw error;
        return new Set((data || []).map(r => r.challenge_id));
    }

    // ---------- vendors (campus counters) ----------
    async function getVendor(id) {
        if (typeof id !== 'string' || !id) return null;
        const { data, error } = await supabase.from('vendors').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    }

    // Vouchers this counter has claimed since sinceMs (for the daily limit and the counter's list).
    async function vendorClaimsSince(vendorId, sinceMs, { countOnly = false } = {}) {
        let q = supabase.from('redemptions')
            .select(countOnly ? 'code' : 'code, item, cost, processed_at, processed_by, user_profiles(name)', countOnly ? { count: 'exact', head: true } : undefined)
            .eq('type', 'points').eq('status', 'Claimed')
            .gte('processed_at', new Date(sinceMs).toISOString());
        if (vendorId) q = q.eq('vendor_id', vendorId);
        if (!countOnly) q = q.order('processed_at', { ascending: false }).limit(200);
        const { data, count, error } = await q;
        if (error) throw error;
        return countOnly ? (count || 0) : (data || []);
    }

    // ---------- fraud flags ----------
    // Best effort: never blocks or fails the request that triggered it. The same user + kind + bin is
    // recorded at most once per 10 minutes, so a retry loop does not flood the console.
    async function recordFlag({ userId = null, binId = null, kind, severity = 'medium', details = {} }) {
        try {
            let q = supabase.from('fraud_flags').select('id')
                .eq('kind', kind)
                .is('resolved_at', null)
                .gte('created_at', new Date(now() - FLAG_DEDUPE_MS).toISOString())
                .limit(1);
            q = userId ? q.eq('user_id', userId) : q.is('user_id', null);
            q = binId !== null && binId !== undefined ? q.eq('bin_id', String(binId)) : q.is('bin_id', null);
            const { data: existing } = await q;
            if (Array.isArray(existing) && existing.length) return false;
            const { error } = await supabase.from('fraud_flags').insert([{
                user_id: userId, bin_id: binId === null || binId === undefined ? null : String(binId), kind, severity, details,
            }]);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('Fraud flag error:', err.message || err);
            return false;
        }
    }

    return {
        getProfile, ensureProfile,
        loadRewardTables, invalidateRewardTables,
        logsSince, previousHashes, applyDeposit,
        applyRedemption, getRedemption, changeRedemptionStatus,
        claimChallenge, claimedChallengeIds,
        getVendor, vendorClaimsSince,
        recordFlag,
    };
}

module.exports = { createStore, LOG_FIELDS };
