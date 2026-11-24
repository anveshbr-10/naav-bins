// Campus wallet payments: exact amounts, one-time codes, counter ownership, expiry.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    generatePaymentCode, parsePaymentCode, walletView, planConvert, planPaymentCreate, effectiveStatus, planPaymentAccess, confirmError, PAY_CODE_RE,
    parseRefundReason, refundError, REFUND_WINDOW_DAYS,
} = require('../lib/payments');

const PROGRAM = { pointsPerRupee: 10 };
const UTSAV = { id: 'utsav-cafe', active: true, max_txn_inr: 500 };

test('codes: NP-XXXX-XXXX, accepted typed or from the QR text', () => {
    const code = generatePaymentCode();
    assert.match(code, PAY_CODE_RE);
    assert.equal(parsePaymentCode(` np-ab23-cd45 `), 'NP-AB23-CD45');
    assert.equal(parsePaymentCode('NAAVPAY:NP-AB23-CD45'), 'NP-AB23-CD45');
    assert.equal(parsePaymentCode('NB-AB23-CD45'), null, 'vouchers are not payments');
    assert.equal(parsePaymentCode(42), null);
});

test('wallet: ₹ balance, coins and how many whole rupees the coins can become', () => {
    assert.deepEqual(walletView(1234, 10, 50), { points: 1234, inr: 50, pointsPerRupee: 10, redeemableInr: 123, minRedeemInr: 1 });
    assert.equal(walletView(7, 3).redeemableInr, 2);
    assert.equal(walletView(-5, 10).points, 0);
    assert.equal(walletView(5, 10, -3).inr, 0);
});

test('convert: whole rupees only, never more than the coins cover', () => {
    assert.deepEqual(planConvert({ ecoPoints: 1234 }, 123, PROGRAM), { points: 1230, amount: 123 });
    assert.deepEqual(planConvert({ ecoPoints: 10 }, 1, PROGRAM), { points: 10, amount: 1 });
    assert.equal(planConvert({ ecoPoints: 1234 }, 124, PROGRAM).reject.params.max, 123);
    assert.equal(planConvert({ ecoPoints: 1234 }, 1.5, PROGRAM).reject.code, 400);
    assert.equal(planConvert({ ecoPoints: 1234 }, 0, PROGRAM).reject.code, 400);
    assert.equal(planConvert({ ecoPoints: 9 }, 1, PROGRAM).reject.params.n, 10);
});

test('create: any whole amount up to the counter limit, if the ₹ wallet covers it', () => {
    assert.deepEqual(planPaymentCreate({ walletBalance: 2 }, UTSAV, 2, PROGRAM), { amount: 2 });
    assert.deepEqual(planPaymentCreate({ walletBalance: 70, ecoPoints: 0 }, UTSAV, 70, PROGRAM), { amount: 70 });
    const short = planPaymentCreate({ walletBalance: 1, ecoPoints: 1e6 }, UTSAV, 2, PROGRAM);
    assert.equal(short.reject.code, 400, 'coins must be redeemed first');
    assert.equal(short.reject.params.have, 1);
    assert.equal(planPaymentCreate({ walletBalance: 1e6 }, UTSAV, 501, PROGRAM).reject.params.max, 500);
    assert.equal(planPaymentCreate({ walletBalance: 1e6 }, UTSAV, 2.5, PROGRAM).reject.code, 400);
    assert.equal(planPaymentCreate({ walletBalance: 1e6 }, UTSAV, 0, PROGRAM).reject.code, 400);
    assert.equal(planPaymentCreate({ walletBalance: 1e6 }, { ...UTSAV, active: false }, 5, PROGRAM).reject.code, 400);
    assert.equal(planPaymentCreate({ walletBalance: 1e6 }, null, 5, PROGRAM).reject.code, 404);
});

test('status: a pending code past its expiry reads as Expired', () => {
    const now = Date.parse('2026-11-23T10:00:00Z');
    assert.equal(effectiveStatus({ status: 'Pending', expires_at: '2026-11-23T10:01:00Z' }, now), 'Pending');
    assert.equal(effectiveStatus({ status: 'Pending', expires_at: '2026-11-23T09:59:00Z' }, now), 'Expired');
    assert.equal(effectiveStatus({ status: 'Completed', expires_at: '2026-11-23T09:59:00Z' }, now), 'Completed');
    assert.equal(effectiveStatus(null, now), null);
});

test('access: counters only see their own payments; admins see all', () => {
    const p = { vendor_id: 'utsav-cafe', vendor_name: 'Utsav Cafe Canteen' };
    assert.deepEqual(planPaymentAccess(p, UTSAV), { ok: true });
    assert.deepEqual(planPaymentAccess(p, null), { ok: true });
    assert.equal(planPaymentAccess(p, { id: 'mtr-stall' }).reject.params.place, 'Utsav Cafe Canteen');
    assert.equal(planPaymentAccess(null, UTSAV).reject.code, 404);
});

test('confirm results map to clear errors', () => {
    assert.equal(confirmError('ok'), null);
    assert.equal(confirmError('expired').code, 410);
    assert.equal(confirmError('insufficient').code, 409);
    assert.equal(confirmError('daily_limit').code, 429);
    assert.equal(confirmError('wrong_vendor').code, 403);
    assert.equal(confirmError('weird').code, 500);
});

test('refund reason: trimmed, 3–200 characters', () => {
    assert.deepEqual(parseRefundReason('  Counter   charged twice '), { reason: 'Counter charged twice' });
    for (const bad of [undefined, null, 42, '', '  ', 'no', 'x'.repeat(201)]) {
        assert.equal(parseRefundReason(bad).reject.code, 400, String(bad));
    }
});

test('refund result -> HTTP error', () => {
    assert.equal(refundError('ok'), null);
    assert.equal(refundError('no_reason').code, 400);
    assert.equal(refundError('not_found').code, 404);
    assert.equal(refundError('not_completed').code, 409);
    const old = refundError('too_old');
    assert.equal(old.code, 409);
    assert.deepEqual(old.params, { n: REFUND_WINDOW_DAYS });
    assert.equal(refundError('weird').code, 500);
});
