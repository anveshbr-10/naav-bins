// Reward decisions. Pure functions: no I/O.
//
// The reward table (per-material points, BBMP stream, weight and CO₂ factors) lives in the database
// (reward_rules). The API loads it and passes it in here; the client only names what happened and
// never decides amounts.
//
// Error messages are English templates with {placeholders}. The API sends the template and its
// parameters along with the rendered text, so the web app can show them in Kannada or Hindi.

const { findNearDuplicate } = require('./imageHash');

const STREAMS = Object.freeze(['dry', 'wet', 'reject']);
const BIN_STREAMS = Object.freeze(['station', ...STREAMS]);
const DAY_MS = 24 * 60 * 60 * 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I

function generateVoucherCode(randomBytes = require('crypto').randomBytes) {
    const chars = Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `NB-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function lookup(table, key) {
    return typeof key === 'string' && table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function render(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? String(params[k]) : m));
}

function reject(code, template, params, flag) {
    return { reject: { code, message: render(template, params), template, params: params || null, ...(flag ? { flag } : {}) } };
}

// ---------- tables from the database ----------

// reward_rules rows -> frozen { [wasteType]: { reward, points, stream, itemKg, co2PerKg, sort } } (active only)
function normalizeRules(rows) {
    const out = {};
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || r.active === false || typeof r.waste_type !== 'string' || !STREAMS.includes(r.stream)) continue;
        out[r.waste_type] = Object.freeze({
            reward: Math.max(0, Math.round(toNumber(r.reward_inr))),
            points: Math.max(0, Math.round(toNumber(r.points))),
            stream: r.stream,
            itemKg: toNumber(r.est_item_kg) > 0 ? toNumber(r.est_item_kg) : 0.05,
            co2PerKg: Math.max(0, toNumber(r.co2_per_kg)),
            sort: toNumber(r.sort),
        });
    }
    return Object.freeze(out);
}

function publicCatalog(rules) {
    const bySort = (a, b) => a[1].sort - b[1].sort;
    return {
        rewards: Object.entries(rules).sort(bySort).map(([wasteType, r]) => ({
            wasteType, reward: r.reward, points: r.points, stream: r.stream,
        })),
    };
}

// ---------- impact ----------

// rows: waste_logs rows or naav_user_material_stats rows. Uses the measured weight when the bin
// weighed the item, otherwise the per-material estimate. CO₂ uses the per-material factor.
function computeImpact(rows, rules) {
    let items = 0, wasteKg = 0, co2Kg = 0, measuredItems = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || row.accepted === false) continue;
        const rule = lookup(rules, row.waste_type);
        const count = row.items !== undefined ? toNumber(row.items) : 1;
        let kg;
        if (row.weight_kg !== undefined && row.weight_kg !== null) kg = toNumber(row.weight_kg);
        else if (row.measured_weight_kg !== undefined && row.measured_weight_kg !== null) kg = toNumber(row.measured_weight_kg);
        else if (row.est_weight_kg !== undefined && row.est_weight_kg !== null) kg = toNumber(row.est_weight_kg);
        else kg = (rule ? rule.itemKg : 0.05) * count;
        items += count;
        wasteKg += kg;
        co2Kg += kg * (rule ? rule.co2PerKg : 0);
        measuredItems += row.measured_items !== undefined ? toNumber(row.measured_items)
            : (row.measured_weight_kg !== undefined && row.measured_weight_kg !== null ? 1 : 0);
    }
    const round = n => Math.round(n * 1000) / 1000;
    return { items, wasteKg: round(wasteKg), co2Kg: round(co2Kg), measuredItems };
}

// ---------- deposits ----------

// Decide what an item identified at a bin does. Pure function.
//   user:        { walletBalance, ecoPoints }
//   recentLogs:  this user's waste_logs from the last 24 hours ({ created_at, bin_id, accepted, session_id })
//   duplicates:  { previous: [{ image_hash, user_id, created_at }], threshold }   earlier captures to compare with
// Returns { reject } or { log, result }.
// A wrong-stream item (e.g. food waste at a dry-waste bin) is recorded with no reward, so the
// operations console can show contamination; the user is told which bin to use.
// pointsOnly: the campus-wallet model (Phase 2) — items earn Eco-Points only, no ₹.
function planWasteDeposit(user, recentLogs, {
    rules, wasteType, bin, sessionId, now, cooldownMs, dailyLimit, imageHash, duplicates, gpsDistance, pointsOnly = false,
}) {
    const rule = lookup(rules, wasteType);
    if (!rule) return reject(400, 'Unknown waste type');

    const logs = Array.isArray(recentLogs) ? recentLogs : [];
    if (sessionId && logs.some(l => l && l.session_id === sessionId)) {
        return reject(409, 'This bin scan has already been used. Please scan the bin QR code again.');
    }

    const binStream = BIN_STREAMS.includes(bin && bin.stream) ? bin.stream : 'station';
    const base = {
        bin_id: bin && bin.id !== undefined ? String(bin.id) : null,
        bin_name: (bin && bin.name) || null,
        waste_type: wasteType,
        stream: rule.stream,
        est_weight_kg: rule.itemKg,
        image_hash: imageHash || null,
        gps_distance_m: Number.isFinite(gpsDistance) ? gpsDistance : null,
    };

    if (binStream !== 'station' && binStream !== rule.stream) {
        return {
            log: { ...base, accepted: false, reject_reason: 'wrong_stream', reward_inr: 0, points: 0, session_id: null },
            result: { accepted: false, reason: 'wrong_stream', stream: rule.stream, binStream, reward: 0, points: 0 },
        };
    }

    // Cooldown per user per bin, counted from the last rewarded item at this bin.
    const binId = base.bin_id;
    const lastHere = logs
        .filter(l => l && l.accepted !== false && String(l.bin_id) === binId)
        .map(l => Date.parse(l.created_at))
        .filter(Number.isFinite);
    const last = lastHere.length ? Math.max(...lastHere) : -Infinity;
    if (now - last < cooldownMs) {
        const seconds = Math.ceil((cooldownMs - (now - last)) / 1000);
        return reject(429, 'Please wait {seconds}s before depositing the next item.', { seconds });
    }

    const itemsLast24h = logs
        .filter(l => l && l.accepted !== false && Date.parse(l.created_at) > now - DAY_MS).length;
    if (itemsLast24h >= dailyLimit) {
        return reject(429, 'Daily deposit limit reached. Please come back tomorrow.', null,
            { kind: 'daily_cap', severity: 'low', details: { limit: dailyLimit } });
    }

    if (imageHash && duplicates && Array.isArray(duplicates.previous)) {
        const dup = findNearDuplicate(imageHash, duplicates.previous, duplicates.threshold ?? 6);
        if (dup) {
            return reject(409, 'This looks like a photo of an item you already deposited. Please show a new item.', null, {
                kind: 'duplicate_photo',
                severity: dup.user_id && dup.user_id !== duplicates.userId ? 'high' : 'medium',
                details: { distance: dup.distance, matchedLog: dup.id || null, matchedUser: dup.user_id || null, hash: imageHash },
            });
        }
    }

    return {
        log: { ...base, accepted: true, reject_reason: null, reward_inr: pointsOnly ? 0 : rule.reward, points: rule.points, session_id: sessionId || null },
        result: { accepted: true, reward: pointsOnly ? 0 : rule.reward, points: rule.points, stream: rule.stream, binStream },
        expected: { walletBalance: toNumber(user.walletBalance), ecoPoints: toNumber(user.ecoPoints) },
    };
}

module.exports = {
    STREAMS, BIN_STREAMS, DAY_MS,
    normalizeRules, publicCatalog, computeImpact,
    planWasteDeposit,
    generateVoucherCode, render, reject,
};
