// Vendor (campus counter) rules. Pure functions: no I/O.
//
// A vendor is a counter on campus — canteen, snack stall, stationery shop, print centre. Counter
// staff (role 'vendor') belong to exactly one vendor and may only look up and claim vouchers issued
// for that vendor, up to the vendor's daily claim limit. Admins may act at any counter.

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

// May this counter see / claim this voucher? Admins (vendor null) may act on any voucher.
function planVoucherAccess(voucher, vendor) {
    if (!voucher || voucher.type !== 'points') return reject(404, 'No voucher with this code.');
    if (!vendor) return { ok: true };
    if (voucher.vendor_id !== vendor.id) {
        return reject(403, 'This voucher is for {place}, not this counter.', { place: voucher.vendor || 'another counter' });
    }
    return { ok: true };
}

// Daily claim limit for a counter. claimedToday counts this vendor's vouchers claimed since IST midnight.
function planDailyLimit(vendor, claimedToday) {
    if (!vendor) return { ok: true };
    const limit = Number(vendor.daily_claim_limit) || 0;
    if (limit > 0 && Number(claimedToday) >= limit) {
        return reject(429, 'This counter has reached its daily limit of {n} vouchers. Please contact the campus team.', { n: limit });
    }
    return { ok: true };
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
    if (has('dailyClaimLimit')) {
        const n = Number(b.dailyClaimLimit);
        if (!Number.isInteger(n) || n < 1 || n > 10000) return reject(400, 'Daily limit must be a whole number from 1 to 10000.');
        values.daily_claim_limit = n;
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

// Settlement: what each counter handed out, so the college can pay the vendors.
//   vendors:     vendors rows
//   redemptions: claimed points redemptions in the period ({ vendor_id, cost })
//   pointsPerRupee: exchange rate (10 points = ₹1 by default)
function summarizeSettlement(vendors, redemptions, pointsPerRupee = 10) {
    const rate = Number(pointsPerRupee) > 0 ? Number(pointsPerRupee) : 10;
    const totals = new Map((vendors || []).map(v => [v.id, { claimed: 0, points: 0 }]));
    for (const r of redemptions || []) {
        const t = r && totals.get(r.vendor_id);
        if (!t) continue;
        t.claimed += 1;
        t.points += Number(r.cost) || 0;
    }
    return (vendors || []).map(v => {
        const t = totals.get(v.id);
        return { vendorId: v.id, claimed: t.claimed, points: t.points, valueInr: Math.round((t.points / rate) * 100) / 100 };
    });
}

module.exports = {
    VENDOR_CATEGORIES, VENDOR_ID_RE,
    istDayStart, planCounterAccess, planVoucherAccess, planDailyLimit, parseVendorInput, summarizeSettlement,
};
