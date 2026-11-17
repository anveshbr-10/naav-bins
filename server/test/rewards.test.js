// Money logic: what a deposit, a redemption and an admin decision do to a user's balances.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    REWARD_MAP, REDEEM_CATALOG, ADMIN_STATUSES,
    planWasteDeposit, planRedemption, planRedemptionStatusChange,
    computeImpact, publicCatalog, generateVoucherCode, isValidUpiId,
} = require('../lib/rewards');

const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DEPOSIT = { binName: 'Main Building Bin', now: NOW, cooldownMs: 30 * 1000, dailyLimit: 3 };

const user = (overrides = {}) => ({ walletBalance: 0, ecoPoints: 0, logs: [], redemptions: [], ...overrides });
const log = (msAgo, session = `s-${msAgo}`) => ({
    date: new Date(NOW - msAgo).toISOString(), wasteType: 'Plastic', amount: 25, session,
});

test('catalogue: every reward and every cost is a positive whole number', () => {
    for (const [type, r] of Object.entries(REWARD_MAP)) {
        assert.ok(Number.isInteger(r.reward) && r.reward > 0, `${type} reward`);
        assert.ok(Number.isInteger(r.points) && r.points > 0, `${type} points`);
    }
    for (const [item, e] of Object.entries(REDEEM_CATALOG)) {
        assert.ok(Number.isInteger(e.cost) && e.cost > 0, `${item} cost`);
        assert.ok(e.type === 'money' || e.type === 'points', `${item} type`);
    }
});

test('catalogue: tables are frozen so request code cannot change prices', () => {
    assert.ok(Object.isFrozen(REWARD_MAP) && Object.isFrozen(REWARD_MAP.Plastic));
    assert.ok(Object.isFrozen(REDEEM_CATALOG) && Object.isFrozen(REDEEM_CATALOG['Bank Transfer']));
});

test('publicCatalog mirrors the server tables', () => {
    const c = publicCatalog();
    assert.equal(c.rewards.length, Object.keys(REWARD_MAP).length);
    assert.deepEqual(c.rewards.find(r => r.wasteType === 'Metal'), { wasteType: 'Metal', reward: 30, points: 150 });
    assert.equal(c.redeem.find(r => r.item === 'Bank Transfer').cost, REDEEM_CATALOG['Bank Transfer'].cost);
});

// ---------------- deposits ----------------

test('deposit: credits the server-defined reward and logs the item', () => {
    const plan = planWasteDeposit(user({ walletBalance: 10, ecoPoints: 5 }), { ...DEPOSIT, wasteType: 'Metal', sessionId: 'jti-1' });
    assert.equal(plan.reject, undefined);
    assert.equal(plan.changes.walletBalance, 40);
    assert.equal(plan.changes.ecoPoints, 155);
    assert.deepEqual(plan.result, { reward: 30, points: 150 });
    const entry = plan.changes.logs.at(-1);
    assert.equal(entry.session, 'jti-1');
    assert.equal(entry.amount, 30);
    assert.equal(entry.location, 'Main Building Bin');
    assert.equal(entry.date, new Date(NOW).toISOString());
});

test('deposit: unknown or inherited waste types are rejected', () => {
    for (const wasteType of ['Gold', '', undefined, 'constructor', '__proto__', 'toString']) {
        assert.equal(planWasteDeposit(user(), { ...DEPOSIT, wasteType, sessionId: 'x' }).reject.code, 400, String(wasteType));
    }
});

test('deposit: one reward per bin scan (session reuse is rejected)', () => {
    const plan = planWasteDeposit(user({ logs: [log(HOUR, 'jti-1')] }), { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'jti-1' });
    assert.equal(plan.reject.code, 409);
});

test('deposit: cooldown between items', () => {
    const tooSoon = planWasteDeposit(user({ logs: [log(10 * 1000)] }), { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'new' });
    assert.equal(tooSoon.reject.code, 429);
    assert.match(tooSoon.reject.message, /wait 20s/);
    const later = planWasteDeposit(user({ logs: [log(30 * 1000)] }), { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'new' });
    assert.equal(later.reject, undefined);
});

test('deposit: daily limit counts only the last 24 hours', () => {
    const full = user({ logs: [log(HOUR), log(2 * HOUR), log(3 * HOUR)] });
    assert.equal(planWasteDeposit(full, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'new' }).reject.code, 429);
    const old = user({ logs: [log(25 * HOUR), log(26 * HOUR), log(HOUR)] });
    assert.equal(planWasteDeposit(old, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'new' }).reject, undefined);
});

test('deposit: missing or corrupt balances are treated as zero, never NaN', () => {
    const plan = planWasteDeposit({ walletBalance: null, ecoPoints: 'abc', logs: null }, { ...DEPOSIT, wasteType: 'Glass', sessionId: 'x' });
    assert.equal(plan.changes.walletBalance, 15);
    assert.equal(plan.changes.ecoPoints, 75);
});

test('deposit: does not mutate the profile it was given', () => {
    const u = user({ logs: [log(HOUR)] });
    const before = structuredClone(u);
    planWasteDeposit(u, { ...DEPOSIT, wasteType: 'Plastic', sessionId: 'x' });
    assert.deepEqual(u, before);
});

// ---------------- redemptions ----------------

test('redeem voucher: deducts points only and issues the code', () => {
    const plan = planRedemption(user({ walletBalance: 50, ecoPoints: 600 }), { item: 'Movie Voucher', now: NOW, code: 'NB-AAAA-BBBB' });
    assert.equal(plan.changes.ecoPoints, 100);
    assert.equal('walletBalance' in plan.changes, false);
    const record = plan.changes.redemptions.at(-1);
    assert.equal(record.status, 'Issued');
    assert.equal(record.code, 'NB-AAAA-BBBB');
    assert.equal(record.cost, 500);
    assert.equal(plan.result.partnerUrl, REDEEM_CATALOG['Movie Voucher'].partnerUrl);
});

test('redeem voucher: exact balance is enough, one point short is not', () => {
    assert.equal(planRedemption(user({ ecoPoints: 200 }), { item: 'Bus Pass', now: NOW, code: 'c' }).changes.ecoPoints, 0);
    const short = planRedemption(user({ ecoPoints: 199 }), { item: 'Bus Pass', now: NOW, code: 'c' });
    assert.deepEqual(short.reject, { code: 400, message: 'Insufficient Points' });
});

test('redeem withdrawal: needs a valid UPI ID and becomes a pending request', () => {
    const bad = planRedemption(user({ walletBalance: 500 }), { item: 'Bank Transfer', now: NOW, code: 'c', upiId: 'not-an-upi' });
    assert.equal(bad.reject.code, 400);
    const plan = planRedemption(user({ walletBalance: 150 }), { item: 'Bank Transfer', now: NOW, code: 'c', upiId: '  name@okaxis ' });
    assert.equal(plan.changes.walletBalance, 50);
    assert.equal('ecoPoints' in plan.changes, false);
    const record = plan.changes.redemptions.at(-1);
    assert.equal(record.status, 'Pending');
    assert.equal(record.upiId, 'name@okaxis');
});

test('redeem withdrawal: insufficient wallet is rejected', () => {
    const plan = planRedemption(user({ walletBalance: 99 }), { item: 'Bank Transfer', now: NOW, code: 'c', upiId: 'ab@ybl' });
    assert.deepEqual(plan.reject, { code: 400, message: 'Insufficient Funds' });
});

test('redeem: unknown items are rejected and cost cannot come from the request', () => {
    assert.equal(planRedemption(user({ ecoPoints: 1e6 }), { item: 'Free iPhone', now: NOW, code: 'c' }).reject.code, 400);
    assert.equal(planRedemption(user({ ecoPoints: 1e6 }), { item: '__proto__', now: NOW, code: 'c' }).reject.code, 400);
    // Extra fields such as a client-supplied cost are ignored: the catalogue price applies.
    const plan = planRedemption(user({ ecoPoints: 1000 }), { item: 'Bus Pass', now: NOW, code: 'c', cost: -500 });
    assert.equal(plan.changes.ecoPoints, 800);
});

// ---------------- admin status changes ----------------

const withRedemption = (r, balances = {}) => user({ ...balances, redemptions: [{ code: 'NB-1', date: new Date(NOW).toISOString(), ...r }] });
const ADMIN = { code: 'NB-1', now: NOW, adminEmail: 'admin@example.com' };

test('admin: paying a withdrawal does not refund', () => {
    const plan = planRedemptionStatusChange(withRedemption({ type: 'money', cost: 100, status: 'Pending' }, { walletBalance: 5 }), { ...ADMIN, status: 'Paid' });
    assert.equal('walletBalance' in plan.changes, false);
    assert.equal(plan.result.status, 'Paid');
    assert.equal(plan.result.processedBy, 'admin@example.com');
    assert.equal(plan.guardRedemptions, true);
});

test('admin: rejecting a withdrawal refunds the wallet', () => {
    const plan = planRedemptionStatusChange(withRedemption({ type: 'money', cost: 100, status: 'Pending' }, { walletBalance: 5 }), { ...ADMIN, status: 'Rejected' });
    assert.equal(plan.changes.walletBalance, 105);
});

test('admin: cancelling a voucher refunds points; claiming does not', () => {
    const issued = withRedemption({ type: 'points', cost: 300, status: 'Issued' }, { ecoPoints: 10 });
    assert.equal(planRedemptionStatusChange(issued, { ...ADMIN, status: 'Cancelled' }).changes.ecoPoints, 310);
    assert.equal('ecoPoints' in planRedemptionStatusChange(issued, { ...ADMIN, status: 'Claimed' }).changes, false);
});

test('admin: a redemption can only be decided once (no double refund)', () => {
    for (const [type, from, to] of [['money', 'Rejected', 'Rejected'], ['money', 'Paid', 'Rejected'], ['points', 'Cancelled', 'Cancelled'], ['points', 'Claimed', 'Cancelled']]) {
        const plan = planRedemptionStatusChange(withRedemption({ type, cost: 100, status: from }), { ...ADMIN, status: to });
        assert.equal(plan.reject.code, 409, `${type} ${from} -> ${to}`);
    }
});

test('admin: statuses must match the redemption type', () => {
    assert.equal(planRedemptionStatusChange(withRedemption({ type: 'money', cost: 100, status: 'Pending' }), { ...ADMIN, status: 'Claimed' }).reject.code, 409);
    assert.equal(planRedemptionStatusChange(withRedemption({ type: 'points', cost: 100, status: 'Issued' }), { ...ADMIN, status: 'Paid' }).reject.code, 409);
    assert.deepEqual([...ADMIN_STATUSES].sort(), ['Cancelled', 'Claimed', 'Paid', 'Rejected']);
});

test('admin: unknown redemption code is a 404', () => {
    assert.equal(planRedemptionStatusChange(user(), { ...ADMIN, status: 'Paid' }).reject.code, 404);
});

test('admin: only the targeted redemption changes', () => {
    const u = user({
        walletBalance: 0,
        redemptions: [
            { code: 'NB-0', type: 'money', cost: 100, status: 'Pending' },
            { code: 'NB-1', type: 'money', cost: 100, status: 'Pending' },
        ],
    });
    const plan = planRedemptionStatusChange(u, { ...ADMIN, status: 'Rejected' });
    assert.equal(plan.changes.redemptions[0].status, 'Pending');
    assert.equal(plan.changes.redemptions[1].status, 'Rejected');
    assert.equal(u.redemptions[1].status, 'Pending', 'input not mutated');
});

// ---------------- helpers ----------------

test('computeImpact: per-material estimates, unknown types count as items only', () => {
    assert.deepEqual(computeImpact([]), { items: 0, wasteKg: 0, co2Kg: 0 });
    assert.deepEqual(computeImpact(null), { items: 0, wasteKg: 0, co2Kg: 0 });
    const r = computeImpact([{ wasteType: 'Metal' }, { wasteType: 'Paper / Cardboard' }, { wasteType: 'Mystery' }]);
    assert.equal(r.items, 3);
    assert.equal(r.wasteKg, 0.115); // 0.015 + 0.05 + 0.05 default
    assert.equal(r.co2Kg, 0.21);    // 0.015*4 + 0.05*3 + 0
});

test('generateVoucherCode: NB-XXXX-XXXX from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) assert.match(generateVoucherCode(), /^NB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(generateVoucherCode(() => Buffer.alloc(8, 0)), 'NB-AAAA-AAAA');
});

test('isValidUpiId', () => {
    for (const ok of ['name@okaxis', 'first.last-1@ybl', ' padded@paytm ']) assert.equal(isValidUpiId(ok), true, ok);
    for (const bad of ['', 'noat', '@bank', 'a@', 'a@1bank', 'a b@bank', null, 42]) assert.equal(isValidUpiId(bad), false, String(bad));
});
