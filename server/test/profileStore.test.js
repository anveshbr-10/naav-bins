// Balance writes use compare-and-swap. These tests run the real store against an in-memory
// stand-in for the Supabase query builder, including simulated concurrent writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileStore } = require('../lib/profileStore');
const { planWasteDeposit, planRedemption, planRedemptionStatusChange } = require('../lib/rewards');

// Minimal fake of supabase.from('user_profiles') supporting the calls profileStore makes.
// hooks.beforeUpdate(rows, attempt) runs just before each UPDATE: use it to simulate another request.
function fakeSupabase(rows, hooks = {}) {
    const stats = { selects: 0, updates: 0, inserts: 0 };
    const from = () => {
        const filters = [];
        let changes = null;
        const q = {
            select() { return q; },
            update(c) { changes = c; return q; },
            eq(col, val) { filters.push(r => r[col] === val); return q; },
            is(col, val) { filters.push(r => (r[col] ?? null) === val); return q; },
            contains(col, json) {
                const wanted = JSON.parse(json);
                filters.push(r => wanted.every(w => (r[col] || []).some(x => x.code === w.code && x.status === w.status)));
                return q;
            },
            insert(newRows) {
                stats.inserts++;
                for (const r of newRows) {
                    if (rows.some(x => x.id === r.id)) return Promise.resolve({ error: { code: '23505' } });
                    rows.push({ walletBalance: 0, ecoPoints: 0, logs: [], redemptions: [], role: 'user', ...r });
                }
                return Promise.resolve({ error: null });
            },
            maybeSingle() {
                stats.selects++;
                const hit = rows.find(r => filters.every(f => f(r)));
                return Promise.resolve({ data: hit ? structuredClone(hit) : null, error: null });
            },
            then(resolve, reject) { // awaiting an UPDATE ... .select('id')
                try {
                    stats.updates++;
                    if (hooks.beforeUpdate) hooks.beforeUpdate(rows, stats.updates);
                    const matched = rows.filter(r => filters.every(f => f(r)));
                    for (const r of matched) Object.assign(r, structuredClone(changes));
                    resolve({ data: matched.map(r => ({ id: r.id })), error: null });
                } catch (e) { reject(e); }
            },
        };
        return q;
    };
    return { client: { from }, stats };
}

const DEPOSIT = { binName: 'Bin', cooldownMs: 0, dailyLimit: 100 };
const profile = (o = {}) => ({ id: 'u1', email: 'u1@example.com', name: 'U1', walletBalance: 0, ecoPoints: 0, logs: [], redemptions: [], ...o });

test('atomicUpdate applies an accepted change', async () => {
    const rows = [profile()];
    const store = createProfileStore(fakeSupabase(rows).client);
    const out = await store.atomicUpdate('u1', u => planWasteDeposit(u, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 's1', now: Date.now() }));
    assert.equal(out.outcome, 'ok');
    assert.deepEqual(out.result, { reward: 25, points: 125 });
    assert.equal(rows[0].walletBalance, 25);
    assert.equal(rows[0].logs.length, 1);
});

test('atomicUpdate passes rejections through without writing', async () => {
    const rows = [profile({ ecoPoints: 10 })];
    const fake = fakeSupabase(rows);
    const out = await createProfileStore(fake.client).atomicUpdate('u1', u => planRedemption(u, { item: 'Bus Pass', now: Date.now(), code: 'c' }));
    assert.deepEqual(out, { outcome: 'rejected', code: 400, message: 'Insufficient Points' });
    assert.equal(fake.stats.updates, 0);
    assert.equal(rows[0].ecoPoints, 10);
});

test('atomicUpdate reports a missing profile', async () => {
    const out = await createProfileStore(fakeSupabase([]).client).atomicUpdate('nobody', () => assert.fail('decide must not run'));
    assert.deepEqual(out, { outcome: 'not_found' });
});

test('a concurrent balance change forces a re-read and re-decision (no lost reward)', async () => {
    const rows = [profile({ walletBalance: 100 })];
    // Before our first write lands, another request credits the same user.
    const fake = fakeSupabase(rows, { beforeUpdate: (r, n) => { if (n === 1) r[0].walletBalance = 130; } });
    const out = await createProfileStore(fake.client).atomicUpdate('u1', u => planWasteDeposit(u, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 's1', now: Date.now() }));
    assert.equal(out.outcome, 'ok');
    assert.equal(fake.stats.updates, 2, 'first write was refused, second applied');
    assert.equal(rows[0].walletBalance, 155, 'both credits kept: 130 + 25');
});

test('double-spend: two redemptions racing for the same balance cannot both succeed', async () => {
    const rows = [profile({ walletBalance: 100 })];
    // The other request withdraws the same ₹100 between our read and our write.
    const fake = fakeSupabase(rows, {
        beforeUpdate: (r, n) => {
            if (n === 1) { r[0].walletBalance = 0; r[0].redemptions = [{ code: 'other', type: 'money', cost: 100, status: 'Pending' }]; }
        },
    });
    const out = await createProfileStore(fake.client).atomicUpdate('u1', u => planRedemption(u, { item: 'Bank Transfer', now: Date.now(), code: 'mine', upiId: 'ab@ybl' }));
    assert.deepEqual(out, { outcome: 'rejected', code: 400, message: 'Insufficient Funds' });
    assert.equal(rows[0].walletBalance, 0, 'never negative');
    assert.equal(rows[0].redemptions.length, 1);
});

test('admin decisions are guarded: a concurrent decision on the same redemption blocks a second refund', async () => {
    const pending = { code: 'NB-1', type: 'money', cost: 100, status: 'Pending' };
    const rows = [profile({ walletBalance: 0, redemptions: [pending] })];
    // Another admin rejects (and refunds) it between our read and our write.
    const fake = fakeSupabase(rows, {
        beforeUpdate: (r, n) => { if (n === 1) { r[0].walletBalance = 100; r[0].redemptions = [{ ...pending, status: 'Rejected' }]; } },
    });
    const out = await createProfileStore(fake.client).atomicUpdate('u1', u =>
        planRedemptionStatusChange(u, { code: 'NB-1', status: 'Rejected', now: Date.now(), adminEmail: 'a@x' }));
    assert.equal(out.outcome, 'rejected');
    assert.equal(out.code, 409);
    assert.equal(rows[0].walletBalance, 100, 'refunded exactly once');
});

test('admin "Paid" (no balance change) still writes thanks to the redemption guard', async () => {
    const rows = [profile({ walletBalance: 7, redemptions: [{ code: 'NB-1', type: 'money', cost: 100, status: 'Pending' }] })];
    const out = await createProfileStore(fakeSupabase(rows).client).atomicUpdate('u1', u =>
        planRedemptionStatusChange(u, { code: 'NB-1', status: 'Paid', now: Date.now(), adminEmail: 'a@x' }));
    assert.equal(out.outcome, 'ok');
    assert.equal(rows[0].redemptions[0].status, 'Paid');
    assert.equal(rows[0].walletBalance, 7);
});

test('atomicUpdate gives up with "conflict" when the row keeps changing', async () => {
    const rows = [profile({ walletBalance: 0 })];
    const fake = fakeSupabase(rows, { beforeUpdate: r => { r[0].walletBalance += 1; } });
    const out = await createProfileStore(fake.client).atomicUpdate('u1', u => planWasteDeposit(u, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 's', now: Date.now() }), 3);
    assert.deepEqual(out, { outcome: 'conflict' });
    assert.equal(fake.stats.updates, 3);
});

test('atomicUpdate refuses unguarded writes that do not touch a balance', async () => {
    const store = createProfileStore(fakeSupabase([profile()]).client);
    await assert.rejects(store.atomicUpdate('u1', () => ({ changes: { name: 'x' }, result: null })), /must modify walletBalance or ecoPoints/);
});

test('ensureProfile returns an existing profile or creates a missing one', async () => {
    const rows = [profile()];
    const fake = fakeSupabase(rows);
    const store = createProfileStore(fake.client);
    assert.equal((await store.ensureProfile({ id: 'u1', email: 'u1@example.com' })).name, 'U1');
    assert.equal(fake.stats.inserts, 0);
    const created = await store.ensureProfile({ id: 'u2', email: 'priya@example.com' });
    assert.equal(created.name, 'priya', 'name falls back to the email user part');
    assert.equal(created.walletBalance, 0);
});
