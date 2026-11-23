// Money logic: what a deposit, a redemption and an admin decision do. Tables come from the database
// in production; here the same rows are passed in directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeRules, normalizeCatalog, publicCatalog, computeImpact,
    planWasteDeposit, planRedemption, planRedemptionStatusChange, ADMIN_STATUSES,
    generateVoucherCode, isValidUpiId, render,
} = require('../lib/rewards');

const RULE_ROWS = [
    { waste_type: 'Plastic', reward_inr: 25, points: 125, stream: 'dry', est_item_kg: 0.025, co2_per_kg: 1, sort: 1 },
    { waste_type: 'Metal', reward_inr: 30, points: 150, stream: 'dry', est_item_kg: 0.015, co2_per_kg: 4, sort: 2 },
    { waste_type: 'Paper / Cardboard', reward_inr: 10, points: 50, stream: 'dry', est_item_kg: 0.05, co2_per_kg: 3, sort: 3 },
    { waste_type: 'Organic', reward_inr: 5, points: 25, stream: 'wet', est_item_kg: 0.1, co2_per_kg: 0.5, sort: 5 },
    { waste_type: 'Other Trash', reward_inr: 8, points: 40, stream: 'reject', est_item_kg: 0.05, co2_per_kg: 0, sort: 6 },
    { waste_type: 'Retired', reward_inr: 99, points: 99, stream: 'dry', active: false },
    { waste_type: 'Bad', reward_inr: 1, points: 1, stream: 'mixed' },
];
const CATALOG_ROWS = [
    { item: 'Canteen Coupon ₹20', type: 'points', cost: 200, description: '₹20 off', vendor: 'Main canteen counter', vendor_id: 'utsav-cafe', labels: { kn: { item: 'ಕೂಪನ್' } }, sort: 1 },
    { item: 'Orphan Coupon', type: 'points', cost: 50, description: 'No counter', vendor: null, sort: 2 },
    { item: 'Bank Transfer', type: 'money', cost: 100, description: 'Withdraw', vendor: null, sort: 9 },
    { item: 'Hidden', type: 'points', cost: 10, active: false },
    { item: 'Free', type: 'points', cost: 0 },
];
const RULES = normalizeRules(RULE_ROWS);
const CATALOG = normalizeCatalog(CATALOG_ROWS);

const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const BIN = { id: 'bin_01', name: 'Main Building Bin', stream: 'station' };
const DEPOSIT = { rules: RULES, bin: BIN, now: NOW, cooldownMs: 20 * 1000, dailyLimit: 3, sessionId: 'jti-new' };
const user = (o = {}) => ({ walletBalance: 0, ecoPoints: 0, ...o });
const log = (msAgo, o = {}) => ({ created_at: new Date(NOW - msAgo).toISOString(), bin_id: 'bin_01', accepted: true, session_id: `s-${msAgo}`, ...o });

// ---------------- tables ----------------

test('tables: inactive or invalid rows are ignored; values are frozen', () => {
    assert.deepEqual(Object.keys(RULES), ['Plastic', 'Metal', 'Paper / Cardboard', 'Organic', 'Other Trash']);
    assert.deepEqual(Object.keys(CATALOG), ['Canteen Coupon ₹20', 'Orphan Coupon', 'Bank Transfer']);
    assert.ok(Object.isFrozen(RULES) && Object.isFrozen(RULES.Plastic) && Object.isFrozen(CATALOG));
    assert.equal(RULES.Organic.stream, 'wet');
});

test('publicCatalog mirrors the database tables in sort order, with labels', () => {
    const c = publicCatalog(RULES, CATALOG);
    assert.deepEqual(c.rewards.find(r => r.wasteType === 'Metal'), { wasteType: 'Metal', reward: 30, points: 150, stream: 'dry' });
    assert.equal(c.redeem[0].item, 'Canteen Coupon ₹20');
    assert.equal(c.redeem[0].vendor, 'Main canteen counter');
    assert.equal(c.redeem[0].labels.kn.item, 'ಕೂಪನ್');
});

// ---------------- deposits ----------------

test('deposit: credits the database-defined reward and builds the log row', () => {
    const plan = planWasteDeposit(user({ walletBalance: 10, ecoPoints: 5 }), [], { ...DEPOSIT, wasteType: 'Metal', imageHash: 'abc', gpsDistance: 12 });
    assert.equal(plan.reject, undefined);
    assert.deepEqual(plan.result, { accepted: true, reward: 30, points: 150, stream: 'dry', binStream: 'station' });
    assert.deepEqual(plan.expected, { walletBalance: 10, ecoPoints: 5 });
    assert.equal(plan.log.reward_inr, 30);
    assert.equal(plan.log.points, 150);
    assert.equal(plan.log.est_weight_kg, 0.015);
    assert.equal(plan.log.session_id, 'jti-new');
    assert.equal(plan.log.bin_id, 'bin_01');
    assert.equal(plan.log.image_hash, 'abc');
    assert.equal(plan.log.gps_distance_m, 12);
});

test('deposit: unknown, inactive or inherited waste types are rejected', () => {
    for (const wasteType of ['Gold', '', undefined, 'Retired', 'constructor', '__proto__', 'toString']) {
        assert.equal(planWasteDeposit(user(), [], { ...DEPOSIT, wasteType }).reject.code, 400, String(wasteType));
    }
});

test('deposit: one reward per bin scan (session reuse is rejected)', () => {
    const plan = planWasteDeposit(user(), [log(HOUR, { session_id: 'jti-new' })], { ...DEPOSIT, wasteType: 'Plastic' });
    assert.equal(plan.reject.code, 409);
});

test('deposit: cooldown applies per user per bin', () => {
    const tooSoon = planWasteDeposit(user(), [log(5 * 1000)], { ...DEPOSIT, wasteType: 'Plastic' });
    assert.equal(tooSoon.reject.code, 429);
    assert.equal(tooSoon.reject.message, 'Please wait 15s before depositing the next item.');
    assert.equal(tooSoon.reject.template, 'Please wait {seconds}s before depositing the next item.');
    assert.deepEqual(tooSoon.reject.params, { seconds: 15 });
    // The same moment at a different bin is fine.
    const otherBin = planWasteDeposit(user(), [log(5 * 1000, { bin_id: 'bin_02' })], { ...DEPOSIT, wasteType: 'Plastic' });
    assert.equal(otherBin.reject, undefined);
    // Wrong-stream attempts do not start a cooldown.
    const afterWrong = planWasteDeposit(user(), [log(5 * 1000, { accepted: false })], { ...DEPOSIT, wasteType: 'Plastic' });
    assert.equal(afterWrong.reject, undefined);
    assert.equal(planWasteDeposit(user(), [log(20 * 1000)], { ...DEPOSIT, wasteType: 'Plastic' }).reject, undefined);
});

test('deposit: daily cap counts rewarded items of the last 24 hours across all bins, and raises a low flag', () => {
    const full = [log(HOUR), log(2 * HOUR, { bin_id: 'b2' }), log(3 * HOUR, { bin_id: 'b3' })];
    const plan = planWasteDeposit(user(), full, { ...DEPOSIT, wasteType: 'Plastic' });
    assert.equal(plan.reject.code, 429);
    assert.equal(plan.reject.flag.kind, 'daily_cap');
    assert.equal(plan.reject.flag.severity, 'low');
    const old = [log(25 * HOUR), log(26 * HOUR), log(HOUR)];
    assert.equal(planWasteDeposit(user(), old, { ...DEPOSIT, wasteType: 'Plastic' }).reject, undefined);
});

test('deposit: wrong stream for a single-stream bin is recorded with no reward (contamination)', () => {
    const dryBin = { id: 'bin_02', name: 'Dry bin', stream: 'dry' };
    const plan = planWasteDeposit(user({ walletBalance: 50 }), [], { ...DEPOSIT, bin: dryBin, wasteType: 'Organic' });
    assert.equal(plan.reject, undefined);
    assert.equal(plan.log.accepted, false);
    assert.equal(plan.log.reject_reason, 'wrong_stream');
    assert.equal(plan.log.reward_inr, 0);
    assert.equal(plan.log.session_id, null, 'does not use up the scan');
    assert.deepEqual(plan.result, { accepted: false, reason: 'wrong_stream', stream: 'wet', binStream: 'dry', reward: 0, points: 0 });
    // Right stream at the same bin is rewarded; a station accepts every stream.
    assert.equal(planWasteDeposit(user(), [], { ...DEPOSIT, bin: dryBin, wasteType: 'Metal' }).log.accepted, true);
    assert.equal(planWasteDeposit(user(), [], { ...DEPOSIT, wasteType: 'Organic' }).log.accepted, true);
});

test('deposit: a near-identical earlier photo is rejected and flagged', () => {
    const previous = [{ id: 'l1', user_id: 'u1', image_hash: 'ffffffffffffffff' }];
    const own = planWasteDeposit(user(), [], {
        ...DEPOSIT, wasteType: 'Plastic', imageHash: 'fffffffffffffff0', duplicates: { previous, threshold: 4, userId: 'u1' },
    });
    assert.equal(own.reject.code, 409);
    assert.equal(own.reject.flag.kind, 'duplicate_photo');
    assert.equal(own.reject.flag.severity, 'medium');
    assert.equal(own.reject.flag.details.distance, 4);
    // Someone else's photo at the same bin is more suspicious.
    const other = planWasteDeposit(user(), [], {
        ...DEPOSIT, wasteType: 'Plastic', imageHash: 'ffffffffffffffff', duplicates: { previous, threshold: 4, userId: 'u2' },
    });
    assert.equal(other.reject.flag.severity, 'high');
    // A different image passes.
    const fresh = planWasteDeposit(user(), [], {
        ...DEPOSIT, wasteType: 'Plastic', imageHash: '0000000000000000', duplicates: { previous, threshold: 4, userId: 'u1' },
    });
    assert.equal(fresh.reject, undefined);
});

test('deposit: missing or corrupt balances are treated as zero, never NaN', () => {
    const plan = planWasteDeposit({ walletBalance: null, ecoPoints: 'abc' }, null, { ...DEPOSIT, wasteType: 'Plastic' });
    assert.deepEqual(plan.expected, { walletBalance: 0, ecoPoints: 0 });
});

// ---------------- redemptions ----------------

test('redeem voucher: issues a campus-credit code to claim at the vendor', () => {
    const plan = planRedemption(user({ walletBalance: 50, ecoPoints: 600 }), { catalog: CATALOG, item: 'Canteen Coupon ₹20', code: 'NB-AAAA-BBBB' });
    assert.deepEqual(plan.redemption, {
        code: 'NB-AAAA-BBBB', item: 'Canteen Coupon ₹20', type: 'points', cost: 200, status: 'Issued', upi_id: null, vendor: 'Main canteen counter', vendor_id: 'utsav-cafe',
    });
    assert.deepEqual(plan.expected, { walletBalance: 50, ecoPoints: 600 });
    assert.equal(plan.result.labels.kn.item, 'ಕೂಪನ್');
});

test('redeem voucher: exact balance is enough, one point short is not', () => {
    assert.equal(planRedemption(user({ ecoPoints: 200 }), { catalog: CATALOG, item: 'Canteen Coupon ₹20', code: 'c' }).reject, undefined);
    const short = planRedemption(user({ ecoPoints: 199 }), { catalog: CATALOG, item: 'Canteen Coupon ₹20', code: 'c' });
    assert.equal(short.reject.code, 400);
    assert.equal(short.reject.message, 'Insufficient Points');
});

test('redeem withdrawal: needs a valid UPI ID and becomes a pending request', () => {
    assert.equal(planRedemption(user({ walletBalance: 500 }), { catalog: CATALOG, item: 'Bank Transfer', code: 'c', upiId: 'nope' }).reject.code, 400);
    const plan = planRedemption(user({ walletBalance: 150 }), { catalog: CATALOG, item: 'Bank Transfer', code: 'c', upiId: '  name@okaxis ' });
    assert.equal(plan.redemption.status, 'Pending');
    assert.equal(plan.redemption.upi_id, 'name@okaxis');
    assert.equal(planRedemption(user({ walletBalance: 99 }), { catalog: CATALOG, item: 'Bank Transfer', code: 'c', upiId: 'ab@ybl' }).reject.message, 'Insufficient Funds');
});

test('redeem: unknown, inactive or inherited items are rejected', () => {
    for (const item of ['Free iPhone', 'Hidden', 'Free', '__proto__', undefined]) {
        assert.equal(planRedemption(user({ ecoPoints: 1e6 }), { catalog: CATALOG, item, code: 'c' }).reject.code, 400, String(item));
    }
});

// ---------------- admin / counter status changes ----------------

test('status: allowed transitions and refunds', () => {
    assert.deepEqual(planRedemptionStatusChange({ type: 'money', status: 'Pending' }, { status: 'Paid' }), { from: 'Pending', to: 'Paid', refund: false });
    assert.deepEqual(planRedemptionStatusChange({ type: 'money', status: 'Pending' }, { status: 'Rejected' }), { from: 'Pending', to: 'Rejected', refund: true });
    assert.deepEqual(planRedemptionStatusChange({ type: 'points', status: 'Issued' }, { status: 'Claimed' }), { from: 'Issued', to: 'Claimed', refund: false });
    assert.deepEqual(planRedemptionStatusChange({ type: 'points', status: 'Issued' }, { status: 'Cancelled' }), { from: 'Issued', to: 'Cancelled', refund: true });
});

test('status: decided once, and statuses must match the type', () => {
    for (const [type, from, to] of [['money', 'Rejected', 'Rejected'], ['money', 'Paid', 'Rejected'], ['points', 'Claimed', 'Cancelled'], ['money', 'Pending', 'Claimed'], ['points', 'Issued', 'Paid']]) {
        assert.equal(planRedemptionStatusChange({ type, status: from }, { status: to }).reject.code, 409, `${type} ${from} -> ${to}`);
    }
    assert.equal(planRedemptionStatusChange(null, { status: 'Paid' }).reject.code, 404);
    assert.deepEqual([...ADMIN_STATUSES].sort(), ['Cancelled', 'Claimed', 'Paid', 'Rejected']);
});

// ---------------- impact ----------------

test('computeImpact: measured weight wins over the estimate; wrong-stream items do not count', () => {
    assert.deepEqual(computeImpact([], RULES), { items: 0, wasteKg: 0, co2Kg: 0, measuredItems: 0 });
    const r = computeImpact([
        { waste_type: 'Metal', est_weight_kg: 0.015 },
        { waste_type: 'Paper / Cardboard', est_weight_kg: 0.05, measured_weight_kg: 0.1 },
        { waste_type: 'Organic', est_weight_kg: 0.1, accepted: false },
        { waste_type: 'Mystery' },
    ], RULES);
    assert.equal(r.items, 3);
    assert.equal(r.measuredItems, 1);
    assert.equal(r.wasteKg, 0.165); // 0.015 + 0.1 + 0.05 default
    assert.equal(r.co2Kg, 0.36);    // 0.015*4 + 0.1*3
});

test('computeImpact: works on aggregated material stats rows', () => {
    const r = computeImpact([{ waste_type: 'Plastic', items: 4, weight_kg: 0.1, measured_items: 2 }], RULES);
    assert.deepEqual(r, { items: 4, wasteKg: 0.1, co2Kg: 0.1, measuredItems: 2 });
});

// ---------------- helpers ----------------

test('render fills placeholders and leaves unknown ones', () => {
    assert.equal(render('Wait {seconds}s at {bin}', { seconds: 5 }), 'Wait 5s at {bin}');
});

test('generateVoucherCode: NB-XXXX-XXXX from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) assert.match(generateVoucherCode(), /^NB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(generateVoucherCode(() => Buffer.alloc(8, 0)), 'NB-AAAA-AAAA');
});

test('isValidUpiId', () => {
    for (const ok of ['name@okaxis', 'first.last-1@ybl', ' padded@paytm ']) assert.equal(isValidUpiId(ok), true, ok);
    for (const bad of ['', 'noat', '@bank', 'a@', 'a@1bank', 'a b@bank', null, 42]) assert.equal(isValidUpiId(bad), false, String(bad));
});

// ---------------- vendors (Phase 1) ----------------

test('redeem voucher: an item with no counter cannot be issued; withdrawals carry no vendor', () => {
    const orphan = planRedemption(user({ ecoPoints: 1000 }), { catalog: CATALOG, item: 'Orphan Coupon', code: 'c' });
    assert.equal(orphan.reject.code, 400);
    const upi = planRedemption(user({ walletBalance: 500 }), { catalog: CATALOG, item: 'Bank Transfer', code: 'c', upiId: 'ab@ybl' });
    assert.equal(upi.redemption.vendor_id, null);
    assert.equal(publicCatalog(RULES, CATALOG).redeem[0].vendorId, 'utsav-cafe');
});

test('status: counter staff can only claim vouchers for their own counter', () => {
    const v = { type: 'points', status: 'Issued', vendor_id: 'utsav-cafe', vendor: 'Utsav Cafe Canteen' };
    assert.equal(planRedemptionStatusChange(v, { status: 'Claimed', vendorId: 'utsav-cafe' }).to, 'Claimed');
    const other = planRedemptionStatusChange(v, { status: 'Claimed', vendorId: 'mtr-stall' });
    assert.equal(other.reject.code, 403);
    assert.equal(other.reject.params.place, 'Utsav Cafe Canteen');
    assert.equal(planRedemptionStatusChange(v, { status: 'Claimed' }).to, 'Claimed', 'admins act anywhere');
});
