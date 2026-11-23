// Delayed cashback: instant part, pending bonus, milestone release with a capped random multiplier,
// expiry after inactivity. The promised points must always be paid in full.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeProgram, pendingState, planCashback, parseProgramInput, LEGACY_PROGRAM, programView,
} = require('../lib/cashback');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T10:00:00Z');
const PROGRAM = normalizeProgram({
    active: true, points_only: true, points_per_rupee: 10, instant_pct: 60, milestones: [10, 5, 20, 5],
    multiplier_min: 1, multiplier_max: 1.3, daily_bonus_budget: 5000, pending_expiry_days: 30,
});
const profile = (o = {}) => ({ ecoPoints: 0, pending_points: 0, cycle_items: 0, last_earn_at: new Date(NOW - DAY).toISOString(), ...o });

test('programme: milestones cleaned and sorted; missing table means legacy behaviour', () => {
    assert.deepEqual([...PROGRAM.milestones], [5, 10, 20]);
    assert.equal(normalizeProgram(null), LEGACY_PROGRAM);
    assert.equal(LEGACY_PROGRAM.active, false);
    assert.equal(LEGACY_PROGRAM.pointsOnly, false);
    assert.equal(normalizeProgram({ milestones: [] }).active, false, 'no milestones = no cashback');
    assert.equal(normalizeProgram({ multiplier_min: 2, multiplier_max: 1.5, milestones: [5] }).multiplierMax, 2);
    assert.equal(programView(LEGACY_PROGRAM).installed, false);
});

test('ordinary item: 60% now, 40% pending, one step closer to the milestone', () => {
    const c = planCashback({ points: 125, profile: profile(), program: PROGRAM, nowMs: NOW });
    assert.equal(c.instant, 75);
    assert.equal(c.deferred, 50);
    assert.equal(c.credit, 75);
    assert.equal(c.pendingAfter, 50);
    assert.equal(c.cycleAfter, 1);
    assert.equal(c.nextMilestone, 5);
    assert.equal(c.itemsToNext, 4);
    assert.equal(c.released, 0);
});

test('milestone: whole pending bonus released, multiplier extra on top', () => {
    const c = planCashback({ points: 125, profile: profile({ pending_points: 200, cycle_items: 4 }), program: PROGRAM, nowMs: NOW, rand: 0.5 });
    assert.equal(c.milestoneHit, 5);
    assert.equal(c.released, 250);           // 200 pending + 50 deferred from this item
    assert.equal(c.multiplier, 1.15);
    assert.equal(c.extra, 37);               // floor(250 × 0.15)
    assert.equal(c.credit, 75 + 250 + 37);
    assert.equal(c.pendingAfter, 0);
    assert.equal(c.cycleAfter, 5);
    assert.equal(c.nextMilestone, 10);
});

test('promise kept: over a full cycle the student gets at least the nominal points', () => {
    let p = profile();
    let credited = 0;
    for (let i = 0; i < 20; i++) {
        const c = planCashback({ points: 125, profile: p, program: PROGRAM, nowMs: NOW, rand: 0 });
        credited += c.credit;
        p = { ...p, pending_points: c.pendingAfter, cycle_items: c.cycleAfter };
    }
    assert.equal(credited, 20 * 125, 'rand 0 = multiplier 1: exactly the promise');
    assert.equal(p.pending_points, 0);
    assert.equal(p.cycle_items, 0, 'last milestone starts a new cycle');
});

test('daily budget caps only the extra, never the promised points', () => {
    const p = profile({ pending_points: 1000, cycle_items: 9 });
    const capped = planCashback({ points: 100, profile: p, program: PROGRAM, nowMs: NOW, rand: 0.99, bonusSpentToday: 4990 });
    assert.equal(capped.released, 1040);
    assert.equal(capped.extra, 10);
    const none = planCashback({ points: 100, profile: p, program: PROGRAM, nowMs: NOW, rand: 0.99, bonusSpentToday: 9999 });
    assert.equal(none.extra, 0);
    assert.equal(none.multiplier, 1);
    assert.equal(none.credit, 60 + 1040);
});

test('expiry: a pending bonus lapses after the inactivity window and the cycle restarts', () => {
    const old = profile({ pending_points: 300, cycle_items: 7, last_earn_at: new Date(NOW - 31 * DAY).toISOString() });
    const s = pendingState(old, PROGRAM, NOW);
    assert.equal(s.pending, 0);
    assert.equal(s.expiredPoints, 300);
    assert.equal(s.cycleItems, 0);
    const c = planCashback({ points: 100, profile: old, program: PROGRAM, nowMs: NOW });
    assert.equal(c.expired, 300);
    assert.equal(c.pendingAfter, 40);
    assert.equal(c.cycleAfter, 1);
    const fresh = pendingState(profile({ pending_points: 300, cycle_items: 7 }), PROGRAM, NOW);
    assert.equal(fresh.pending, 300);
    assert.equal(fresh.expiresAt, new Date(NOW - DAY + 30 * DAY).toISOString());
});

test('programme off: everything paid at once, including what was pending', () => {
    const off = normalizeProgram({ active: false, milestones: [5] });
    const c = planCashback({ points: 125, profile: profile({ pending_points: 80, cycle_items: 3 }), program: off, nowMs: NOW });
    assert.equal(c.credit, 205);
    assert.equal(c.pendingAfter, 0);
    assert.equal(c.cycleAfter, 0);
});

test('programme input: validated and converted to columns', () => {
    const ok = parseProgramInput({
        active: true, pointsOnly: true, pointsPerRupee: 10, instantPct: 50, dailyBonusBudget: 1000, expiryDays: 14,
        milestones: [3, 6], multiplierMin: 1, multiplierMax: 1.5,
    });
    assert.deepEqual(ok.values, {
        active: true, points_only: true, points_per_rupee: 10, instant_pct: 50, daily_bonus_budget: 1000,
        pending_expiry_days: 14, milestones: [3, 6], multiplier_min: 1, multiplier_max: 1.5,
    });
    const base = { active: true, pointsOnly: true, pointsPerRupee: 10, instantPct: 50, dailyBonusBudget: 0, expiryDays: 14, milestones: [5], multiplierMin: 1, multiplierMax: 1 };
    assert.equal(parseProgramInput(base).values.multiplier_max, 1);
    assert.equal(parseProgramInput({ ...base, instantPct: 101 }).reject.code, 400);
    assert.equal(parseProgramInput({ ...base, milestones: [5, 5] }).reject.code, 400);
    assert.equal(parseProgramInput({ ...base, milestones: [] }).reject.code, 400);
    assert.equal(parseProgramInput({ ...base, multiplierMin: 1.5, multiplierMax: 1.2 }).reject.code, 400);
    assert.equal(parseProgramInput({ ...base, active: 'yes' }).reject.code, 400);
});
