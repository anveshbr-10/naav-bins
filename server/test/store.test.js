// The store retries when the transactional SQL function reports a concurrent balance change, so a
// second request re-decides with fresh data (no double-spend, no reward past the cooldown).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store');
const { planWasteDeposit, normalizeRules } = require('../lib/rewards');

const RULES = normalizeRules([{ waste_type: 'Plastic', reward_inr: 25, points: 125, stream: 'dry', est_item_kg: 0.025 }]);
const NOW = Date.parse('2026-11-17T10:00:00.000Z');

// In-memory stand-in for the Supabase client: tables + the SQL functions' semantics.
function fakeSupabase(db, hooks = {}) {
    const calls = { rpc: [], inserts: [] };
    const from = (table) => {
        const filters = [];
        let op = 'select';
        let payload = null;
        let limit = Infinity;
        const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)));
        const q = {
            select() { return q; },
            insert(p) { op = 'insert'; payload = p; return q; },
            update(p) { op = 'update'; payload = p; return q; },
            eq(c, v) { filters.push(r => r[c] === v); return q; },
            is(c, v) { filters.push(r => (r[c] ?? null) === v); return q; },
            gte(c, v) { filters.push(r => String(r[c]) >= String(v)); return q; },
            like(c, v) { const pre = v.replace('%', ''); filters.push(r => String(r[c]).startsWith(pre)); return q; },
            not() { return q; },
            order() { return q; },
            limit(n) { limit = n; return q; },
            maybeSingle() { const hit = rows()[0]; return Promise.resolve({ data: hit ? structuredClone(hit) : null, error: null }); },
            then(resolve) {
                if (op === 'insert') {
                    calls.inserts.push({ table, rows: payload });
                    (db[table] = db[table] || []).push(...structuredClone(payload));
                    return resolve({ data: null, error: null });
                }
                if (op === 'update') {
                    for (const r of rows()) Object.assign(r, payload);
                    return resolve({ data: null, error: null });
                }
                return resolve({ data: structuredClone(rows().slice(0, limit)), error: null });
            },
        };
        return q;
    };
    const rpc = (name, args) => {
        calls.rpc.push({ name, args });
        if (hooks.beforeRpc) hooks.beforeRpc(db, calls.rpc.length, name);
        const p = (db.user_profiles || []).find(u => u.id === args.p_user);
        if (name === 'naav_apply_deposit_v2') {
            const e = args.p_expected;
            const cas = p && p.walletBalance === e.walletBalance && p.ecoPoints === e.ecoPoints
                && (p.pending_points || 0) === e.pendingPoints && (p.cycle_items || 0) === e.cycleItems;
            if ((db.waste_logs || []).some(l => l.session_id && l.session_id === args.p_log.session_id)) return Promise.resolve({ data: 'duplicate_session', error: null });
            if (!cas) return Promise.resolve({ data: 'conflict', error: null });
            p.walletBalance += args.p_log.reward_inr;
            p.ecoPoints += args.p_award.credit;
            p.pending_points = args.p_award.pending_after;
            p.cycle_items = args.p_award.cycle_after;
            (db.waste_logs = db.waste_logs || []).push({ user_id: args.p_user, created_at: new Date(NOW).toISOString(), ...args.p_log });
            return Promise.resolve({ data: 'ok', error: null });
        }
        if (name === 'naav_claim_challenge') {
            if ((db.challenge_claims || []).some(c => c.user_id === args.p_user && c.challenge_id === args.p_challenge)) return Promise.resolve({ data: 'already_claimed', error: null });
            (db.challenge_claims = db.challenge_claims || []).push({ user_id: args.p_user, challenge_id: args.p_challenge });
            p.ecoPoints += args.p_points;
            return Promise.resolve({ data: 'ok', error: null });
        }
        throw new Error(`unexpected rpc ${name}`);
    };
    return { client: { from, rpc }, calls };
}

const profile = (o = {}) => ({ id: 'u1', email: 'u1@example.com', name: 'U1', walletBalance: 0, ecoPoints: 0, ...o });
// Like the API: an accepted item carries a cashback award (here: all points at once).
const deposit = (sessionId, bin = { id: 'b1', name: 'Bin', stream: 'station' }) => (user, recent) => {
    const plan = planWasteDeposit(user, recent, {
        rules: RULES, wasteType: 'Plastic', bin, sessionId, now: NOW, cooldownMs: 20000, dailyLimit: 30, pointsOnly: true,
    });
    if (plan.reject || !plan.log.accepted) return plan;
    const award = { credit: plan.log.points, instant: plan.log.points, pending_after: 0, cycle_after: 0, released: 0, expired: 0 };
    return { ...plan, award };
};
const opts = { now: () => NOW };

test('applyDeposit credits the points and stores the log in one call', async () => {
    const db = { user_profiles: [profile()], waste_logs: [] };
    const fake = fakeSupabase(db);
    const out = await createStore(fake.client, opts).applyDeposit('u1', deposit('s1'));
    assert.equal(out.outcome, 'ok');
    assert.equal(db.user_profiles[0].ecoPoints, 125);
    assert.equal(db.user_profiles[0].walletBalance, 0, 'points only: no ₹ from deposits');
    assert.equal(db.waste_logs.length, 1);
    assert.equal(fake.calls.rpc[0].name, 'naav_apply_deposit_v2');
    assert.deepEqual(fake.calls.rpc[0].args.p_expected, { walletBalance: 0, ecoPoints: 0, pendingPoints: 0, cycleItems: 0 });
});

test('a concurrent deposit forces a re-read, and the per-bin cooldown then applies (no double reward)', async () => {
    const db = { user_profiles: [profile()], waste_logs: [] };
    // Before our write lands, another request deposits at the same bin for the same user.
    const fake = fakeSupabase(db, {
        beforeRpc: (d, n) => {
            if (n !== 1) return;
            d.user_profiles[0].ecoPoints = 125;
            d.waste_logs.push({ user_id: 'u1', bin_id: 'b1', accepted: true, created_at: new Date(NOW).toISOString(), session_id: 'other' });
        },
    });
    const out = await createStore(fake.client, opts).applyDeposit('u1', deposit('s1'));
    assert.equal(out.outcome, 'rejected');
    assert.equal(out.code, 429);
    assert.equal(db.user_profiles[0].ecoPoints, 125, 'only the other deposit was credited');
});

test('a reused scan session is rejected by the database', async () => {
    const db = { user_profiles: [profile()], waste_logs: [{ user_id: 'u2', session_id: 's1', created_at: '2026-01-01T00:00:00Z', bin_id: 'x' }] };
    const out = await createStore(fakeSupabase(db).client, opts).applyDeposit('u1', deposit('s1'));
    assert.equal(out.outcome, 'rejected');
    assert.equal(out.code, 409);
});

test('a wrong-stream item is inserted directly with no balance change', async () => {
    const db = { user_profiles: [profile({ walletBalance: 7 })], waste_logs: [] };
    const fake = fakeSupabase(db);
    const wet = { id: 'b9', name: 'Wet bin', stream: 'wet' };
    const out = await createStore(fake.client, opts).applyDeposit('u1', deposit('s1', wet));
    assert.equal(out.outcome, 'ok');
    assert.equal(out.result.accepted, false);
    assert.equal(fake.calls.rpc.length, 0);
    assert.equal(db.waste_logs[0].accepted, false);
    assert.equal(db.user_profiles[0].walletBalance, 7);
});

test('challenge bonus is credited once', async () => {
    const db = { user_profiles: [profile()], challenge_claims: [] };
    const store = createStore(fakeSupabase(db).client, opts);
    assert.equal(await store.claimChallenge('u1', '2026-11-16:weekly_items', 150), 'ok');
    assert.equal(await store.claimChallenge('u1', '2026-11-16:weekly_items', 150), 'already_claimed');
    assert.equal(db.user_profiles[0].ecoPoints, 150);
    assert.deepEqual([...await store.claimedChallengeIds('u1', '2026-11-16')], ['2026-11-16:weekly_items']);
});

test('fraud flags are de-duplicated for 10 minutes and never throw', async () => {
    const db = { fraud_flags: [] };
    const store = createStore(fakeSupabase(db).client, opts);
    assert.equal(await store.recordFlag({ userId: 'u1', binId: 'b1', kind: 'geofence' }), true);
    db.fraud_flags[0].created_at = new Date(NOW).toISOString();
    assert.equal(await store.recordFlag({ userId: 'u1', binId: 'b1', kind: 'geofence' }), false);
    assert.equal(await store.recordFlag({ userId: 'u1', binId: 'b2', kind: 'geofence' }), true);
    const broken = createStore({ from: () => { throw new Error('db down'); } }, opts);
    assert.equal(await broken.recordFlag({ userId: 'u1', kind: 'x' }), false);
});

test('ensureProfile returns an existing profile or creates a missing one', async () => {
    const db = { user_profiles: [profile()] };
    const fake = fakeSupabase(db);
    const store = createStore(fake.client, opts);
    assert.equal((await store.ensureProfile({ id: 'u1', email: 'u1@example.com' })).name, 'U1');
    assert.equal(fake.calls.inserts.length, 0);
    const created = await store.ensureProfile({ id: 'u2', email: 'priya@example.com' });
    assert.equal(created.name, 'priya', 'name falls back to the email user part');
});

test('reward tables are read from the database and cached', async () => {
    const db = {
        reward_rules: [{ waste_type: 'Plastic', reward_inr: 1, points: 10, stream: 'dry', est_item_kg: 0.02 }],
    };
    let t = NOW;
    const store = createStore(fakeSupabase(db).client, { now: () => t });
    assert.equal((await store.loadRewardTables()).rules.Plastic.reward, 1);
    db.reward_rules[0].reward_inr = 2;
    assert.equal((await store.loadRewardTables()).rules.Plastic.reward, 1, 'cached');
    store.invalidateRewardTables();
    assert.equal((await store.loadRewardTables()).rules.Plastic.reward, 2, 'refreshed after an edit');
    t += 61 * 1000;
    db.reward_rules[0].reward_inr = 3;
    assert.equal((await store.loadRewardTables()).rules.Plastic.reward, 3, 'expires after a minute');
});
