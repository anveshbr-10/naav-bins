// Server-side source of truth for rewards and redemptions.
// The client never decides amounts, costs or types — it only names what happened.

const REWARD_MAP = Object.freeze({
    'Plastic':           Object.freeze({ reward: 25, points: 125 }),
    'Metal':             Object.freeze({ reward: 30, points: 150 }),
    'Paper / Cardboard': Object.freeze({ reward: 10, points: 50 }),
    'Organic':           Object.freeze({ reward: 5,  points: 25 }),
    'Glass':             Object.freeze({ reward: 15, points: 75 }),
    'Other Trash':       Object.freeze({ reward: 8,  points: 40 }),
});

const REDEEM_CATALOG = Object.freeze({
    'Movie Voucher': Object.freeze({
        cost: 500, type: 'points', description: 'Get ₹200 off on BookMyShow',
        partner: 'BookMyShow', partnerUrl: 'https://in.bookmyshow.com',
    }),
    'Bus Pass': Object.freeze({
        cost: 200, type: 'points', description: 'One Day City Bus Pass',
        partner: 'BMTC', partnerUrl: 'https://mybmtc.karnataka.gov.in',
    }),
    'Metro Recharge': Object.freeze({
        cost: 300, type: 'points', description: 'Add ₹50 to your Metro Card',
        partner: 'Namma Metro', partnerUrl: 'https://english.bmrc.co.in',
    }),
    'Bank Transfer': Object.freeze({
        cost: 100, type: 'money', description: 'Withdraw ₹100 to your UPI ID',
        partner: null, partnerUrl: null,
    }),
});

// Estimated environmental impact per deposited item.
// itemKg: typical weight of one item of that material (bottle, can, carton...).
// co2PerKg: kg CO2e avoided per kg recycled instead of landfilled — conservative, rounded-down values
// based on US EPA WARM recycling factors. These are estimates until bins can weigh items.
const IMPACT = Object.freeze({
    'Plastic':           Object.freeze({ itemKg: 0.025, co2PerKg: 1.0 }),
    'Metal':             Object.freeze({ itemKg: 0.015, co2PerKg: 4.0 }),
    'Paper / Cardboard': Object.freeze({ itemKg: 0.05,  co2PerKg: 3.0 }),
    'Organic':           Object.freeze({ itemKg: 0.1,   co2PerKg: 0.5 }),
    'Glass':             Object.freeze({ itemKg: 0.25,  co2PerKg: 0.3 }),
    'Other Trash':       Object.freeze({ itemKg: 0.05,  co2PerKg: 0 }),
});
const DEFAULT_IMPACT = Object.freeze({ itemKg: 0.05, co2PerKg: 0 });

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I

const DAY_MS = 24 * 60 * 60 * 1000;

function generateVoucherCode(randomBytes = require('crypto').randomBytes) {
    const chars = Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `NB-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function isValidUpiId(value) {
    return typeof value === 'string' && UPI_RE.test(value.trim());
}

// Totals derived from the activity log. Stored per-log weights from older versions were placeholders,
// so impact is always recomputed from the per-material estimates.
function computeImpact(logs) {
    const list = Array.isArray(logs) ? logs : [];
    let wasteKg = 0;
    let co2Kg = 0;
    for (const log of list) {
        const f = lookup(IMPACT, log && log.wasteType) || DEFAULT_IMPACT;
        wasteKg += f.itemKg;
        co2Kg += f.itemKg * f.co2PerKg;
    }
    const round = n => Math.round(n * 1000) / 1000;
    return { items: list.length, wasteKg: round(wasteKg), co2Kg: round(co2Kg) };
}

function publicCatalog() {
    return {
        rewards: Object.entries(REWARD_MAP).map(([wasteType, r]) => ({ wasteType, reward: r.reward, points: r.points })),
        redeem: Object.entries(REDEEM_CATALOG).map(([item, e]) => ({ item, ...e })),
    };
}

function lookup(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function reject(code, message) {
    return { reject: { code, message } };
}

// Decide what a waste deposit does to a profile. Pure function: no I/O.
function planWasteDeposit(user, { wasteType, binName, sessionId, now, cooldownMs, dailyLimit }) {
    const rule = lookup(REWARD_MAP, wasteType);
    if (!rule) return reject(400, 'Unknown waste type');

    const logs = Array.isArray(user.logs) ? user.logs : [];

    // One reward per verified bin scan (persisted in the log, so it survives restarts).
    if (logs.some(log => log && log.session === sessionId)) {
        return reject(409, 'This bin scan has already been used. Please scan the bin QR code again.');
    }

    const times = logs.map(log => Date.parse(log && log.date)).filter(Number.isFinite);
    const last = times.length ? Math.max(...times) : -Infinity;
    if (now - last < cooldownMs) {
        const wait = Math.ceil((cooldownMs - (now - last)) / 1000);
        return reject(429, `Please wait ${wait}s before depositing the next item.`);
    }

    const itemsLast24h = times.filter(t => t > now - DAY_MS).length;
    if (itemsLast24h >= dailyLimit) {
        return reject(429, 'Daily deposit limit reached. Please come back tomorrow.');
    }

    const newLog = {
        date: new Date(now).toISOString(),
        wasteType,
        weight: (lookup(IMPACT, wasteType) || DEFAULT_IMPACT).itemKg, // estimated kg

        amount: rule.reward,
        location: binName,
        session: sessionId,
    };

    return {
        changes: {
            walletBalance: toNumber(user.walletBalance) + rule.reward,
            ecoPoints: toNumber(user.ecoPoints) + rule.points,
            logs: [...logs, newLog],
        },
        result: { reward: rule.reward, points: rule.points },
    };
}

// Decide what a redemption does to a profile. Pure function: no I/O.
// Points items issue a voucher code immediately; money withdrawals become a pending payout request.
function planRedemption(user, { item, now, code, upiId }) {
    const entry = lookup(REDEEM_CATALOG, item);
    if (!entry) return reject(400, 'Unknown reward item');
    if (entry.type === 'money' && !isValidUpiId(upiId)) return reject(400, 'Please enter a valid UPI ID (e.g. name@bank).');

    const wallet = toNumber(user.walletBalance);
    const points = toNumber(user.ecoPoints);
    const changes = {};

    if (entry.type === 'money') {
        if (wallet < entry.cost) return reject(400, 'Insufficient Funds');
        changes.walletBalance = wallet - entry.cost;
    } else {
        if (points < entry.cost) return reject(400, 'Insufficient Points');
        changes.ecoPoints = points - entry.cost;
    }

    const record = {
        date: new Date(now).toISOString(),
        item,
        cost: entry.cost,
        type: entry.type,
        code,
        status: entry.type === 'money' ? 'Pending' : 'Issued',
    };
    if (entry.type === 'money') record.upiId = upiId.trim();

    const redemptions = Array.isArray(user.redemptions) ? user.redemptions : [];
    changes.redemptions = [...redemptions, record];

    return {
        changes,
        result: { ...record, partner: entry.partner, partnerUrl: entry.partnerUrl },
    };
}

// Admin status changes for redemptions. The boolean says whether the cost is refunded to the user.
const STATUS_TRANSITIONS = Object.freeze({
    money:  Object.freeze({ Pending: Object.freeze({ Paid: false, Rejected: true }) }),
    points: Object.freeze({ Issued:  Object.freeze({ Claimed: false, Cancelled: true }) }),
});
const ADMIN_STATUSES = Object.freeze(['Paid', 'Rejected', 'Claimed', 'Cancelled']);

function planRedemptionStatusChange(user, { code, status, now, adminEmail }) {
    const redemptions = Array.isArray(user.redemptions) ? user.redemptions : [];
    const index = redemptions.findIndex(r => r && r.code === code);
    if (index === -1) return reject(404, 'Redemption not found');

    const record = redemptions[index];
    const allowed = lookup(STATUS_TRANSITIONS, record.type) || {};
    const fromStatus = lookup(allowed, record.status);
    if (!fromStatus || !Object.prototype.hasOwnProperty.call(fromStatus, status)) {
        return reject(409, `A ${record.status || 'completed'} redemption cannot be marked ${status}.`);
    }

    const updated = { ...record, status, processedAt: new Date(now).toISOString(), processedBy: adminEmail };
    const changes = { redemptions: redemptions.map((r, i) => (i === index ? updated : r)) };

    if (fromStatus[status]) {
        const cost = toNumber(record.cost);
        if (record.type === 'money') changes.walletBalance = toNumber(user.walletBalance) + cost;
        else changes.ecoPoints = toNumber(user.ecoPoints) + cost;
    }

    // guardRedemptions: the write only applies if no other redemption changed status in the meantime.
    return { changes, result: updated, guardRedemptions: true };
}

module.exports = {
    REWARD_MAP, REDEEM_CATALOG, IMPACT, ADMIN_STATUSES,
    planWasteDeposit, planRedemption, planRedemptionStatusChange,
    computeImpact, publicCatalog, generateVoucherCode, isValidUpiId,
};
