// Delayed cashback (Phase 3) and the reward programme settings. Pure functions: no I/O.
//
// Each accepted item is worth its full points (reward_rules.points). Part is paid at once
// (instantPct); the rest is added to a visible pending bonus. When the student's item count in the
// current cycle reaches a milestone (e.g. 5, 10, 20), the whole pending bonus is released, with a
// random multiplier on top (multiplierMin … multiplierMax) as long as today's bonus budget allows.
// After the last milestone a new cycle starts. A pending bonus expires after expiryDays without a
// deposit. The full promised points are always paid at the milestone: only the extra is random.

const { reject } = require('./rewards');

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PROGRAM = Object.freeze({
    active: true,
    pointsOnly: true,
    pointsPerRupee: 10,
    instantPct: 60,
    milestones: Object.freeze([5, 10, 20]),
    multiplierMin: 1,
    multiplierMax: 1.3,
    dailyBonusBudget: 5000,
    expiryDays: 30,
});

// Used when the reward_program table does not exist yet (004 not run): the old behaviour.
const LEGACY_PROGRAM = Object.freeze({ ...DEFAULT_PROGRAM, active: false, pointsOnly: false, legacy: true });

function cleanMilestones(list) {
    const out = [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 1000))];
    return out.sort((a, b) => a - b).slice(0, 10);
}

// reward_program row -> frozen programme (falls back to defaults field by field).
function normalizeProgram(row) {
    if (!row) return LEGACY_PROGRAM;
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const milestones = cleanMilestones(row.milestones);
    const min = Math.max(1, num(row.multiplier_min, DEFAULT_PROGRAM.multiplierMin));
    const max = Math.max(min, Math.min(3, num(row.multiplier_max, DEFAULT_PROGRAM.multiplierMax)));
    return Object.freeze({
        active: row.active !== false && milestones.length > 0,
        pointsOnly: row.points_only !== false,
        pointsPerRupee: Math.max(1, Math.round(num(row.points_per_rupee, DEFAULT_PROGRAM.pointsPerRupee))),
        instantPct: Math.min(100, Math.max(0, Math.round(num(row.instant_pct, DEFAULT_PROGRAM.instantPct)))),
        milestones: Object.freeze(milestones),
        multiplierMin: min,
        multiplierMax: max,
        dailyBonusBudget: Math.max(0, Math.round(num(row.daily_bonus_budget, DEFAULT_PROGRAM.dailyBonusBudget))),
        expiryDays: Math.min(365, Math.max(1, Math.round(num(row.pending_expiry_days, DEFAULT_PROGRAM.expiryDays)))),
    });
}

function nextMilestone(program, cycleItems) {
    const m = program.milestones.find(x => x > cycleItems);
    return m === undefined ? null : m;
}

// The student's cashback state right now (applies expiry). profile: user_profiles row.
function pendingState(profile, program, nowMs) {
    const pending = Math.max(0, Math.round(Number(profile && profile.pending_points) || 0));
    const cycleItems = Math.max(0, Math.round(Number(profile && profile.cycle_items) || 0));
    const lastEarn = Date.parse(profile && profile.last_earn_at);
    const expiresAtMs = Number.isFinite(lastEarn) ? lastEarn + program.expiryDays * DAY_MS : null;
    const expired = pending > 0 && expiresAtMs !== null && nowMs > expiresAtMs;
    const cycle = expired ? 0 : cycleItems;
    const next = nextMilestone(program, cycle);
    return {
        pending: expired ? 0 : pending,
        expiredPoints: expired ? pending : 0,
        cycleItems: cycle,
        nextMilestone: next,
        itemsToNext: next === null ? null : next - cycle,
        expiresAt: !expired && pending > 0 && expiresAtMs !== null ? new Date(expiresAtMs).toISOString() : null,
    };
}

// What one accepted item pays. rand: a number in [0, 1) (crypto-random in production).
// bonusSpentToday: extra points already given today across all students (for the budget).
function planCashback({ points, profile, program, nowMs, rand = 0, bonusSpentToday = 0 }) {
    const P = Math.max(0, Math.round(Number(points) || 0));
    const state = pendingState(profile, program, nowMs);
    const base = { expired: state.expiredPoints, released: 0, multiplier: 1, extra: 0, milestoneHit: null };

    if (!program.active) {
        // Programme switched off: everything is paid at once, including anything still pending.
        return {
            ...base, instant: P, deferred: 0, released: state.pending,
            credit: P + state.pending, pendingAfter: 0, cycleAfter: 0, cycleItem: null, nextMilestone: null, itemsToNext: null,
        };
    }

    const instant = Math.floor((P * program.instantPct) / 100);
    const deferred = P - instant;
    const item = state.cycleItems + 1;
    const last = program.milestones[program.milestones.length - 1];

    if (program.milestones.includes(item)) {
        const released = state.pending + deferred;
        const r = Math.min(Math.max(Number(rand) || 0, 0), 0.999999);
        const multiplier = Math.round((program.multiplierMin + r * (program.multiplierMax - program.multiplierMin)) * 100) / 100;
        const room = Math.max(0, program.dailyBonusBudget - Math.max(0, Number(bonusSpentToday) || 0));
        const extra = Math.min(Math.floor(released * (multiplier - 1)), room);
        const cycleAfter = item >= last ? 0 : item;
        const next = nextMilestone(program, cycleAfter);
        return {
            ...base, instant, deferred, released, multiplier: extra > 0 ? multiplier : 1, extra, milestoneHit: item,
            credit: instant + released + extra, pendingAfter: 0, cycleAfter, cycleItem: item,
            nextMilestone: next, itemsToNext: next === null ? null : next - cycleAfter,
        };
    }

    const next = nextMilestone(program, item);
    return {
        ...base, instant, deferred,
        credit: instant, pendingAfter: state.pending + deferred, cycleAfter: item, cycleItem: item,
        nextMilestone: next, itemsToNext: next === null ? null : next - item,
    };
}

// Admin input for the programme. Returns { reject } or { values } (database columns).
function parseProgramInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
    const values = {};
    for (const [k, col] of [['active', 'active'], ['pointsOnly', 'points_only']]) {
        if (typeof b[k] !== 'boolean') return reject(400, 'Invalid request');
        values[col] = b[k];
    }
    const checks = [
        ['pointsPerRupee', 'points_per_rupee', 1, 1000],
        ['instantPct', 'instant_pct', 0, 100],
        ['dailyBonusBudget', 'daily_bonus_budget', 0, 10000000],
        ['expiryDays', 'pending_expiry_days', 1, 365],
    ];
    for (const [k, col, lo, hi] of checks) {
        const n = int(b[k], lo, hi);
        if (n === null) return reject(400, '{field} must be a whole number from {min} to {max}.', { field: k, min: lo, max: hi });
        values[col] = n;
    }
    const milestones = cleanMilestones(b.milestones);
    if (!milestones.length || milestones.length !== (Array.isArray(b.milestones) ? b.milestones.length : -1)) {
        return reject(400, 'Milestones must be 1–10 different whole numbers from 1 to 1000.');
    }
    values.milestones = milestones;
    const min = Number(b.multiplierMin);
    const max = Number(b.multiplierMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max > 3 || max < min) {
        return reject(400, 'Multiplier must be between 1 and 3, with the maximum at least the minimum.');
    }
    values.multiplier_min = Math.round(min * 100) / 100;
    values.multiplier_max = Math.round(max * 100) / 100;
    return { values };
}

function programView(program) {
    const { legacy, ...rest } = program;
    return { ...rest, installed: !legacy };
}

module.exports = {
    DEFAULT_PROGRAM, LEGACY_PROGRAM, DAY_MS,
    normalizeProgram, pendingState, planCashback, parseProgramInput, programView, nextMilestone,
};
