// Vendor (campus counter) rules: who may use a counter, vendor input, settlement.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    istDayStart, planCounterAccess, parseVendorInput, summarizeSettlement,
} = require('../lib/vendors');

const UTSAV = { id: 'utsav-cafe', name: 'Utsav Cafe Canteen', active: true };
const MTR = { id: 'mtr-stall', name: 'MTR Snacks Stall', active: true };

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

test('vendor input: create needs id, name and category; update takes any valid subset', () => {
    const ok = parseVendorInput({ id: ' Night-Canteen ', name: ' Night Canteen ', category: 'canteen', labels: { kn: 'ರಾತ್ರಿ', hi: '' } });
    assert.deepEqual(ok.values, { id: 'night-canteen', name: 'Night Canteen', category: 'canteen', labels: { kn: 'ರಾತ್ರಿ' } });
    assert.equal(parseVendorInput({ id: 'x', name: 'Night', category: 'canteen' }).reject.code, 400, 'id too short');
    assert.equal(parseVendorInput({ id: 'bad id!', name: 'Night', category: 'canteen' }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'night', name: 'N', category: 'canteen' }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'night', name: 'Night', category: 'casino' }).reject.code, 400);
    assert.deepEqual(parseVendorInput({ active: false }, { partial: true }).values, { active: false });
    assert.equal(parseVendorInput({ active: 'no' }, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({}, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({ id: 'abc' }, { partial: true }).reject.code, 400, 'id cannot change');
});

test('settlement: completed campus-wallet payments per counter', () => {
    const rows = summarizeSettlement([UTSAV, MTR], [
        { vendor_id: 'utsav-cafe', amount_inr: 2 }, { vendor_id: 'utsav-cafe', amount_inr: 70 }, { vendor_id: 'gone', amount_inr: 5 }, null,
    ]);
    assert.deepEqual(rows, [
        { vendorId: 'utsav-cafe', payments: 2, paymentsInr: 72 },
        { vendorId: 'mtr-stall', payments: 0, paymentsInr: 0 },
    ]);
    assert.deepEqual(summarizeSettlement([UTSAV]), [{ vendorId: 'utsav-cafe', payments: 0, paymentsInr: 0 }]);
});

test('vendor input: payment limits are whole rupees in range', () => {
    assert.deepEqual(parseVendorInput({ maxTxnInr: 200, dailyLimitInr: 5000 }, { partial: true }).values, { max_txn_inr: 200, daily_limit_inr: 5000 });
    assert.equal(parseVendorInput({ maxTxnInr: 0 }, { partial: true }).reject.code, 400);
    assert.equal(parseVendorInput({ dailyLimitInr: 1.5 }, { partial: true }).reject.code, 400);
});
