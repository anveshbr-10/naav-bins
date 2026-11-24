// Vendor (campus counter) rules. Pure functions: no I/O.
//
// A vendor is a counter on campus — canteen, snack stall, stationery shop, print centre. Counter
// staff (role 'vendor') belong to exactly one vendor and may only look up and confirm campus-wallet
// payments made at that vendor. Admins may act at any counter.

const { reject } = require('./rewards');

const VENDOR_ID_RE = /^[a-z0-9-]{2,40}$/;
const VENDOR_CATEGORIES = Object.freeze(['canteen', 'snacks', 'stationery', 'print', 'other']);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Start of the current calendar day in India (IST), as epoch milliseconds.
function istDayStart(nowMs) {
    return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

// Can this signed-in profile use the counter? Returns { reject } or { vendor } (null for admins).
function planCounterAccess(profile, vendor) {
    if (!profile) return reject(401, 'Please sign in.');
    if (profile.role === 'admin') return { vendor: null };
    if (profile.role !== 'vendor') return reject(403, 'Counter access required');
    if (!vendor || vendor.id !== profile.vendor_id) {
        return reject(403, 'This account is not linked to a counter. Please contact the campus team.');
    }
    if (vendor.active === false) return reject(403, 'Your counter is switched off. Please contact the campus team.');
    return { vendor };
}

// Validates admin input for creating (partial = false) or updating (partial = true) a vendor.
// Returns { reject } or { values } with only the columns to write.
function parseVendorInput(body, { partial = false } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const values = {};
    const has = k => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

    if (!partial) {
        const id = typeof b.id === 'string' ? b.id.trim().toLowerCase() : '';
        if (!VENDOR_ID_RE.test(id)) return reject(400, 'Vendor ID must be 2–40 lowercase letters, numbers or dashes.');
        values.id = id;
    }
    if (!partial || has('name')) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (name.length < 2 || name.length > 80) return reject(400, 'Vendor name must be 2–80 characters.');
        values.name = name;
    }
    if (!partial || has('category')) {
        if (!VENDOR_CATEGORIES.includes(b.category)) return reject(400, 'Invalid request');
        values.category = b.category;
    }
    if (has('location')) {
        if (typeof b.location !== 'string' || b.location.trim().length > 120) return reject(400, 'Invalid request');
        values.location = b.location.trim();
    }
    for (const [k, col, max] of [['maxTxnInr', 'max_txn_inr', 100000], ['dailyLimitInr', 'daily_limit_inr', 10000000]]) {
        if (!has(k)) continue;
        const n = Number(b[k]);
        if (!Number.isInteger(n) || n < 1 || n > max) return reject(400, 'Payment limits must be whole rupees from ₹1 to ₹{max}.', { max });
        values[col] = n;
    }
    if (has('active')) {
        if (typeof b.active !== 'boolean') return reject(400, 'Invalid request');
        values.active = b.active;
    }
    if (has('labels')) {
        const l = b.labels;
        if (!l || typeof l !== 'object' || Array.isArray(l)) return reject(400, 'Invalid request');
        const labels = {};
        for (const lang of ['kn', 'hi']) {
            if (l[lang] === undefined || l[lang] === '') continue;
            if (typeof l[lang] !== 'string' || l[lang].trim().length > 80) return reject(400, 'Invalid request');
            labels[lang] = l[lang].trim();
        }
        values.labels = labels;
    }
    if (partial && !Object.keys(values).length) return reject(400, 'Invalid request');
    return { values };
}

// Settlement: what each counter took in campus-wallet payments, so the college can pay the vendors.
//   vendors:  vendors rows
//   payments: completed campus-wallet payments in the period ({ vendor_id, amount_inr })
function summarizeSettlement(vendors, payments = []) {
    const totals = new Map((vendors || []).map(v => [v.id, { payments: 0, paymentsInr: 0 }]));
    for (const p of payments || []) {
        const t = p && totals.get(p.vendor_id);
        if (!t) continue;
        t.payments += 1;
        t.paymentsInr += Number(p.amount_inr) || 0;
    }
    return (vendors || []).map(v => ({ vendorId: v.id, ...totals.get(v.id) }));
}

module.exports = {
    VENDOR_CATEGORIES, VENDOR_ID_RE,
    istDayStart, planCounterAccess, parseVendorInput, summarizeSettlement,
};
