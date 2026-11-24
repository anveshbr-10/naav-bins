// Campus wallet payments. Pure functions: no I/O.
//
// Like coins in a UPI app: students earn Eco-Points by recycling, then REDEEM them into ₹ in their
// campus wallet (pointsPerRupee points = ₹1, whole rupees only). The ₹ wallet is spent at campus
// counters: the student enters the exact amount (₹2 photocopy, ₹70 record book) and shows a one-time
// code / QR valid for a few minutes, tied to one counter. Counter staff confirm it, and exactly that
// amount is deducted from the ₹ wallet (naav_confirm_payment).

const { reject, generateVoucherCode } = require('./rewards');

const PAYMENT_TTL_MS = 3 * 60 * 1000;
const PAY_CODE_RE = /^NP-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const QR_PREFIX = 'NAAVPAY:';

function generatePaymentCode(randomBytes) {
    return `NP-${generateVoucherCode(randomBytes).slice(3)}`;
}

// Accepts a typed code or the scanned QR text. Returns the normalised code or null.
function parsePaymentCode(input) {
    let s = typeof input === 'string' ? input.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (s.startsWith(QR_PREFIX)) s = s.slice(QR_PREFIX.length);
    return PAY_CODE_RE.test(s) ? s : null;
}

const MIN_CONVERT_INR = 1;

// points = Eco-Points (coins); inr = ₹ campus wallet; redeemableInr = whole ₹ the points can become now.
function walletView(points, pointsPerRupee, walletInr = 0) {
    const p = Math.max(0, Math.round(Number(points) || 0));
    const rate = Math.max(1, Number(pointsPerRupee) || 10);
    const inr = Math.max(0, Math.round(Number(walletInr) || 0));
    return { points: p, inr, pointsPerRupee: rate, redeemableInr: Math.floor(p / rate), minRedeemInr: MIN_CONVERT_INR };
}

// Redeem Eco-Points into ₹ in the campus wallet. amountInr = whole rupees wanted.
// Returns { reject } or { points, amount }.
function planConvert(profile, amountInr, program) {
    const amount = Number(amountInr);
    const rate = Math.max(1, Number(program && program.pointsPerRupee) || 10);
    const have = Math.max(0, Math.round(Number(profile && profile.ecoPoints) || 0));
    const max = Math.floor(have / rate);
    if (max < MIN_CONVERT_INR) return reject(400, 'You need at least {n} Eco-Points to redeem ₹1.', { n: rate });
    if (!Number.isInteger(amount) || amount < MIN_CONVERT_INR || amount > max) {
        return reject(400, 'Enter a whole amount from ₹1 to ₹{max}.', { max });
    }
    return { points: amount * rate, amount };
}

// Can this student start a payment of amountInr at this counter? Returns { reject } or { amount }.
function planPaymentCreate(profile, vendor, amountInr, program) {
    if (!vendor) return reject(404, 'Vendor not found');
    if (vendor.active === false) return reject(400, 'This counter is closed right now.');
    const amount = Number(amountInr);
    const max = Number(vendor.max_txn_inr) || 500;
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        return reject(400, 'Enter a whole amount from ₹1 to ₹{max}.', { max });
    }
    const have = Math.max(0, Math.round(Number(profile && profile.walletBalance) || 0));
    if (have < amount) {
        return reject(400, 'Not enough in your campus wallet: you have ₹{have}. Redeem Eco-Points to add money.', { have });
    }
    return { amount };
}

// The status a student or counter should see (a Pending code past its expiry is Expired).
function effectiveStatus(payment, nowMs) {
    if (!payment) return null;
    if (payment.status === 'Pending' && Date.parse(payment.expires_at) < nowMs) return 'Expired';
    return payment.status;
}

// Can this counter see this payment? vendor null = admin.
function planPaymentAccess(payment, vendor) {
    if (!payment) return reject(404, 'No payment with this code.');
    if (vendor && payment.vendor_id !== vendor.id) {
        return reject(403, 'This payment is for {place}, not this counter.', { place: payment.vendor_name || 'another counter' });
    }
    return { ok: true };
}

// Refunds: admins only, once, within REFUND_WINDOW_DAYS of the payment, with a reason.
const REFUND_WINDOW_DAYS = 7;
function parseRefundReason(input) {
    const s = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
    if (s.length < 3 || s.length > 200) return reject(400, 'Please give a reason for the refund (3–200 characters).');
    return { reason: s };
}
const REFUND_ERRORS = Object.freeze({
    no_reason: reject(400, 'Please give a reason for the refund (3–200 characters).'),
    not_found: reject(404, 'No payment with this code.'),
    not_completed: reject(409, 'Only a completed payment can be refunded, once.'),
    too_old: reject(409, 'Payments can only be refunded within {n} days.', { n: REFUND_WINDOW_DAYS }),
});
function refundError(result) {
    if (result === 'ok') return null;
    const r = REFUND_ERRORS[result];
    return r ? r.reject : { code: 500, template: 'Server Error' };
}

// naav_confirm_payment result -> HTTP error, or null on success. (reject() so the texts are translated.)
const CONFIRM_ERRORS = Object.freeze({
    not_found: reject(404, 'No payment with this code.'),
    wrong_vendor: reject(403, 'This payment is for another counter.'),
    not_pending: reject(409, 'This code was already used or cancelled.'),
    expired: reject(410, 'This code has expired. Ask the student to create a new one.'),
    daily_limit: reject(429, 'This counter has reached its daily payment limit. Please contact the campus team.'),
    insufficient: reject(409, 'The student no longer has enough in their campus wallet.'),
});
function confirmError(result) {
    if (result === 'ok') return null;
    const r = CONFIRM_ERRORS[result];
    return r ? { code: r.reject.code, template: r.reject.template } : { code: 500, template: 'Server Error' };
}

module.exports = {
    PAYMENT_TTL_MS, PAY_CODE_RE, QR_PREFIX,
    REFUND_WINDOW_DAYS, parseRefundReason, refundError,
    generatePaymentCode, parsePaymentCode, walletView, planConvert, MIN_CONVERT_INR, planPaymentCreate, effectiveStatus, planPaymentAccess, confirmError,
};
