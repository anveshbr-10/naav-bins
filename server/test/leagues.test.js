const test = require('node:test');
const assert = require('node:assert/strict');
const {
    istDayKey, istWeek, computeStreak, userStats, computeBadges,
    weeklyChallenges, computeChallenges, computeStandings, computeIndividuals,
} = require('../lib/leagues');

// Tuesday 17 Nov 2026, 15:30 IST.
const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (iso, o = {}) => ({ created_at: iso, accepted: true, waste_type: 'Plastic', points: 125, user_id: 'u1', ...o });

test('IST days and Monday weeks', () => {
    assert.equal(istDayKey(Date.parse('2026-11-16T19:00:00Z')), '2026-11-17', '00:30 IST is the next day');
    const w = istWeek(NOW);
    assert.equal(w.key, '2026-11-16');
    assert.equal(new Date(w.startMs).toISOString(), '2026-11-15T18:30:00.000Z');
    assert.equal(w.endMs - w.startMs, 7 * DAY);
});

test('streak: consecutive IST days; alive until the end of today', () => {
    const logs = [at('2026-11-15T05:00:00Z'), at('2026-11-16T05:00:00Z'), at('2026-11-16T06:00:00Z')];
    assert.deepEqual(computeStreak(logs, NOW), { current: 2, longest: 2, activeToday: false });
    assert.deepEqual(computeStreak([...logs, at('2026-11-17T04:00:00Z')], NOW), { current: 3, longest: 3, activeToday: true });
    assert.equal(computeStreak([at('2026-11-14T05:00:00Z')], NOW).current, 0, 'broken streak');
    assert.deepEqual(computeStreak([], NOW), { current: 0, longest: 0, activeToday: false });
    assert.equal(computeStreak([at('2026-11-16T05:00:00Z', { accepted: false })], NOW).current, 0, 'wrong-stream items do not count');
});

test('badges: progress and earned flags', () => {
    const logs = [
        at('2026-11-16T01:00:00Z'), // 06:30 IST — early bird
        at('2026-11-16T05:00:00Z', { waste_type: 'Metal' }),
        at('2026-11-17T05:00:00Z', { waste_type: 'Organic' }),
    ];
    const badges = Object.fromEntries(computeBadges(userStats(logs, NOW)).map(b => [b.id, b]));
    assert.equal(badges.first_drop.earned, true);
    assert.deepEqual(badges.ten_strong, { id: 'ten_strong', target: 10, progress: 3, earned: false });
    assert.equal(badges.early_bird.earned, true);
    assert.equal(badges.streak_3.progress, 2);
    assert.equal(badges.all_rounder.progress, 3);
    const dirty = userStats([...logs, at('2026-11-17T06:00:00Z', { accepted: false, reject_reason: 'wrong_stream' })], NOW);
    assert.equal(computeBadges(dirty).find(b => b.id === 'clean_sorter').progress, 0);
});

test('weekly challenges: three per week, ids scoped to the week, rotating', () => {
    const { challenges } = weeklyChallenges(NOW);
    assert.equal(challenges.length, 3);
    assert.equal(challenges[0].slug, 'weekly_items');
    assert.ok(challenges.every(c => c.id.startsWith('2026-11-16:')));
    assert.equal(new Set(challenges.map(c => c.slug)).size, 3);
    const next = weeklyChallenges(NOW + 7 * DAY).challenges;
    assert.notDeepEqual(next.map(c => c.slug), challenges.map(c => c.slug));
});

test('weekly challenges: progress, completion and claimed state', () => {
    const logs = Array.from({ length: 16 }, (_, i) => at(new Date(NOW - i * 60000).toISOString()));
    const first = weeklyChallenges(NOW).challenges[0].id;
    const r = computeChallenges(logs, new Set([first]), NOW);
    assert.equal(r.week.key, '2026-11-16');
    const items = r.challenges[0];
    assert.equal(items.progress, 15, 'capped at the target');
    assert.equal(items.completed, true);
    assert.equal(items.claimed, true);
});

const PROFILES = [
    { id: 'u1', name: 'Asha', role: 'user', department: 'cse', hostel: 'h1' },
    { id: 'u2', name: 'Ravi', role: 'user', department: 'cse', hostel: 'h2' },
    { id: 'u3', name: 'Meena', role: 'user', department: 'ece', hostel: 'h1' },
    { id: 'u4', name: 'Admin', role: 'admin', department: 'ece', hostel: null },
];
const GROUPS = [
    { id: 'cse', kind: 'department', name: 'CSE' },
    { id: 'ece', kind: 'department', name: 'ECE' },
    { id: 'mech', kind: 'department', name: 'Mech' },
    { id: 'h1', kind: 'hostel', name: 'H1' },
    { id: 'h2', kind: 'hostel', name: 'H2' },
];
const LOGS = [
    { user_id: 'u1', points: 100 }, { user_id: 'u1', points: 50 }, { user_id: 'u2', points: 25 },
    { user_id: 'u3', points: 200 }, { user_id: 'u4', points: 999 }, { user_id: 'u3', points: 500, accepted: false },
];

test('department league: totals, members, ranks; admins and wrong-stream items excluded; empty groups listed', () => {
    const rows = computeStandings('department', LOGS, PROFILES, GROUPS);
    assert.deepEqual(rows.map(r => [r.id, r.points, r.items, r.members, r.activeMembers, r.rank]), [
        ['ece', 200, 1, 1, 1, 1],
        ['cse', 175, 3, 2, 2, 2],
        ['mech', 0, 0, 0, 0, 3],
    ]);
    assert.equal(rows[1].pointsPerMember, 88);
});

test('hostel league and aggregated (all-time) input', () => {
    const rows = computeStandings('hostel', [{ user_id: 'u1', points: 300, items: 3 }, { user_id: 'u2', points: 300, items: 2 }], PROFILES, GROUPS);
    // Equal points share rank 1; the smaller hostel lists first (more points per member).
    assert.deepEqual(rows.map(r => [r.id, r.points, r.items, r.rank]), [['h2', 300, 2, 1], ['h1', 300, 3, 1]]);
});

test('individual weekly table', () => {
    const rows = computeIndividuals(LOGS, PROFILES);
    assert.deepEqual(rows.map(r => [r.name, r.points, r.rank]), [['Meena', 200, 1], ['Asha', 150, 2], ['Ravi', 25, 3]]);
    assert.equal(rows[0].department, 'ece');
});
