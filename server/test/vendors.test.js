// Vendor (campus counter) rules: who may use a counter, which vouchers it can see, daily limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    istDayStart, planCounterAccess, planVoucherAccess, planDailyLimit, parseVendorInput, summarizeSettlement,
} = require('../lib/vendors');

const UTSAV = { id: 'utsav-cafe', name: 'Utsav Cafe Canteen', active: true, daily_claim_limit: 3 };
const MTR = { id: 'mtr-stall', name: 'MTR Snacks Stall', active: true, daily_claim_limit: 300 };

test('IST day start: midnight in India, not UTC', () => {
    // 2026-11-17 20:00 UTC is 2026-11-18 01:30 IST -> day starts 2026-11-17 18:30 UTC.
    assert.equal(new Date(istDayStart(Date.parse('2026-11-17T20:00:00Z'))).toISOString(), '2026-11-17T18:30:00.000Z');
    assert.equal(new Date(istDayStart(Date.parse('2026-11-17T10:00:00Z'))).toISOString(), '2026-11-16T18:30:00.000Z');
});

test('counter access: admins anywhere, staff only at their own active counter', () => {
    assert.deepEqual(planCounterAccess({ role: 'admin' }, null), { vendor: null });
    assert.equal(planCounterAccess({ role: 'vendor', vendor_id: 'utsav-cafe' }, UTSAV).vendor, UTSAV);
    assert.equal(planCounterAccess({ role: 'user' }, null).reject.code, 403);
    assert.equal(planCounterAccess({ role: 'vendor', vendor_id: null }, null).reject.code, 403);
    assert.equal(planCounterAccess({ role: 'vendor', vendor_id: 'utsav-cafe' }, MTR).reject.code, 403);
    assert.equal(planCounterAccess({ role: 'vendor', vendor_id: 'utsav-cafe' }, { ...UTSAV, active: false }).reject.code, 403);
    assert.equal(planCounterAccess(null, null).reject.code, 401);
});

test('voucher access: only vouchers for this counter; withdrawals are never vouchers', () => {
    const v = { type: 'points', vendor_id: 'utsav-cafe', vendor: 'Utsav Cafe Canteen' };
    assert.deepEqual(planVoucherAccess(v, UTSAV), { ok: true });
    assert.deepEqual(planVoucherAccess(v, null), { ok: true });
    const wrong = planVoucherAccess(v, MTR);
    assert.equal(wrong.reject.code, 403);
    assert.equal(wrong.reject.message, 'This voucher is for Utsav Cafe Canteen, not this counter.');
    assert.equal(planVoucherAccess({ type: 'money' }, UTSAV).reject.code, 404);
    assert.equal(planVoucherAccess(null, UTSAV).reject.code, 404);
    assert.equal(planVoucherAccess({ type: 'points', vendor_id: null }, UTSAV).reject.code, 403, 'unassigned vouchers need an admin');
});

test('daily limit: stops at the limit, admins are not limited', () => {
    assert.deepEqual(planDailyLimit(UTSAV, 2), { ok: true });
    assert.equal(planDailyLimit(UTSAV, 3).reject.code, 429);
    assert.equal(planDailyLimit(UTSAV, 3).reject.params.n, 3);
    assert.deepEqual(planDailyLimit(null, 9999), { ok: true });
});

test('vendor input: create needs id, name and category; update takes any valid subset', () => {
    const ok = parseVendorInput({ id: ' Night-Canteen ', name: ' Night Canteen ', category: 'canteen', dailyClaimLimit: 50, labels: { kn: 'ರಾತ್ರಿ', hi: '' } });
    assert.deepEqual(ok.values, { id: 'night-canteen', name: 'Night Canteen', category: 'canteen', daily_claim_limit: 50, labels: { kn: 'ರಾತ್ರಿ' } });
    assert.equal(parseVendorInput({ id: 'x', name: 'Night', category: 'canteen' }).reject.code, 400, 'id too short');
    assert.equal(parseVendorInput({ id: 'bad id!', name: 'Night', category: 'canteen' }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'night', name: 'N', category: 'canteen' }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'night', name: 'Night', category: 'casino' }).reject.code, 400);
    assert.deepEqual(parseVendorInput({ active: false }, { partial: true }).values, { active: false });
    assert.equal(parseVendorInput({ active: 'no' }, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({ dailyClaimLimit: 0 }, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({ dailyClaimLimit: 2.5 }, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({}, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'abc' }, { partial: true }).reject.code, 400, 'id cannot change');
});

test('settlement: claimed points per counter, converted at the exchange rate', () => {
    const rows = summarizeSettlement([UTSAV, MTR], [
        { vendor_id: 'utsav-cafe', cost: 200 }, { vendor_id: 'utsav-cafe', cost: 450 }, { vendor_id: 'gone', cost: 999 }, null,
    ], 10);
    assert.deepEqual(rows, [
        { vendorId: 'utsav-cafe', claimed: 2, points: 650, valueInr: 65 },
        { vendorId: 'mtr-stall', claimed: 0, points: 0, valueInr: 0 },
    ]);
    assert.equal(summarizeSettlement([UTSAV], [{ vendor_id: 'utsav-cafe', cost: 25 }], 0)[0].valueInr, 2.5, 'bad rate falls back to 10');
});

test('catalogue: credits of a switched-off counter are not offered', () => {
    const { normalizeCatalog } = require('../lib/rewards');
    const c = normalizeCatalog([
        { item: 'On', type: 'points', cost: 10, vendor_id: 'a', vendors: { active: true } },
        { item: 'Off', type: 'points', cost: 10, vendor_id: 'b', vendors: { active: false } },
    ]);
    assert.deepEqual(Object.keys(c), ['On']);
});
