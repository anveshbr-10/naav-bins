// Campus leagues, streaks, badges and weekly challenges. Pure functions: no I/O.
// Days and weeks follow Indian Standard Time (UTC+5:30); weeks start on Monday.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 'YYYY-MM-DD' of the IST calendar day containing the instant.
function istDayKey(ms) {
    return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istHour(ms) {
    return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

// Monday 00:00 IST of the week containing `nowMs`, as { startMs, endMs, key }.
function istWeek(nowMs) {
    const local = new Date(nowMs + IST_OFFSET_MS);
    const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
    const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DAY_MS;
    const startMs = mondayLocal - IST_OFFSET_MS;
    return { startMs, endMs: startMs + 7 * DAY_MS, key: new Date(mondayLocal).toISOString().slice(0, 10) };
}

function weekNumber(weekKey) {
    return Math.floor(Date.parse(`${weekKey}T00:00:00Z`) / (7 * DAY_MS));
}

const accepted = logs => (Array.isArray(logs) ? logs : []).filter(l => l && l.accepted !== false && Number.isFinite(Date.parse(l.created_at)));
// League inputs: raw logs (one item each) or per-user aggregates ({ user_id, points, items }).
const countable = rows => (Array.isArray(rows) ? rows : []).filter(l => l && l.accepted !== false);
const itemCount = l => (l.items !== undefined && l.items !== null ? Number(l.items) || 0 : 1);

// Consecutive IST days with at least one accepted item. The current streak stays alive until the end
// of today, so a user who recycled yesterday but not yet today still has their streak.
function computeStreak(logs, nowMs) {
    const days = new Set(accepted(logs).map(l => istDayKey(Date.parse(l.created_at))));
    if (!days.size) return { current: 0, longest: 0, activeToday: false };

    const sorted = [...days].sort();
    let longest = 1, run = 1;
    for (let i = 1; i < sorted.length; i++) {
        const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / DAY_MS;
        run = gap === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    const today = istDayKey(nowMs);
    const activeToday = days.has(today);
    let cursor = activeToday ? Date.parse(today) : Date.parse(today) - DAY_MS;
    let current = 0;
    while (days.has(new Date(cursor).toISOString().slice(0, 10))) { current++; cursor -= DAY_MS; }
    return { current, longest, activeToday };
}

// Badge ids are stable; the web app shows the localised name and description for each id.
const BADGES = Object.freeze([
    { id: 'first_drop',      target: 1,   metric: s => s.items },
    { id: 'ten_strong',      target: 10,  metric: s => s.items },
    { id: 'half_century',    target: 50,  metric: s => s.items },
    { id: 'century',         target: 100, metric: s => s.items },
    { id: 'streak_3',        target: 3,   metric: s => s.longestStreak },
    { id: 'streak_7',        target: 7,   metric: s => s.longestStreak },
    { id: 'plastic_hunter',  target: 25,  metric: s => s.byType.Plastic || 0 },
    { id: 'paper_saver',     target: 25,  metric: s => s.byType['Paper / Cardboard'] || 0 },
    { id: 'composter',       target: 10,  metric: s => s.byType.Organic || 0 },
    { id: 'all_rounder',     target: 5,   metric: s => s.distinctTypes },
    { id: 'early_bird',      target: 1,   metric: s => s.earlyItems },
    { id: 'clean_sorter',    target: 20,  metric: s => (s.wrongStream === 0 ? s.items : 0) },
]);

function userStats(logs, nowMs) {
    const all = Array.isArray(logs) ? logs : [];
    const ok = accepted(all);
    const byType = {};
    let earlyItems = 0;
    for (const l of ok) {
        byType[l.waste_type] = (byType[l.waste_type] || 0) + 1;
        if (istHour(Date.parse(l.created_at)) < 8) earlyItems++;
    }
    const streak = computeStreak(ok, nowMs);
    return {
        items: ok.length,
        byType,
        distinctTypes: Object.keys(byType).length,
        earlyItems,
        wrongStream: all.filter(l => l && l.accepted === false && l.reject_reason === 'wrong_stream').length,
        streak,
        longestStreak: streak.longest,
    };
}

function computeBadges(stats) {
    return BADGES.map(b => {
        const value = b.metric(stats);
        return { id: b.id, target: b.target, progress: Math.min(value, b.target), earned: value >= b.target };
    });
}

// Weekly challenges: one fixed volume goal plus two that rotate every week.
const CHALLENGE_POOL = Object.freeze([
    { slug: 'weekly_items',  metric: 'items', target: 15, bonus: 150 },
    { slug: 'plastic_8',     metric: 'type', wasteType: 'Plastic', target: 8, bonus: 120 },
    { slug: 'paper_8',       metric: 'type', wasteType: 'Paper / Cardboard', target: 8, bonus: 100 },
    { slug: 'metal_5',       metric: 'type', wasteType: 'Metal', target: 5, bonus: 120 },
    { slug: 'glass_3',       metric: 'type', wasteType: 'Glass', target: 3, bonus: 100 },
    { slug: 'organic_5',     metric: 'type', wasteType: 'Organic', target: 5, bonus: 100 },
    { slug: 'days_4',        metric: 'days', target: 4, bonus: 150 },
    { slug: 'variety_3',     metric: 'types', target: 3, bonus: 100 },
    { slug: 'clean_week',    metric: 'clean', target: 10, bonus: 120 },
]);

function weeklyChallenges(nowMs) {
    const week = istWeek(nowMs);
    const n = weekNumber(week.key);
    const rotating = CHALLENGE_POOL.slice(1);
    const a = rotating[((n % rotating.length) + rotating.length) % rotating.length];
    const b = rotating[(((n + 4) % rotating.length) + rotating.length) % rotating.length];
    return { week, challenges: [CHALLENGE_POOL[0], a, b].map(c => ({ ...c, id: `${week.key}:${c.slug}` })) };
}

function challengeProgress(challenge, weekLogs) {
    const all = Array.isArray(weekLogs) ? weekLogs : [];
    const ok = accepted(all);
    switch (challenge.metric) {
        case 'items': return ok.length;
        case 'type': return ok.filter(l => l.waste_type === challenge.wasteType).length;
        case 'days': return new Set(ok.map(l => istDayKey(Date.parse(l.created_at)))).size;
        case 'types': return new Set(ok.map(l => l.waste_type)).size;
        case 'clean': return all.some(l => l && l.reject_reason === 'wrong_stream') ? 0 : ok.length;
        default: return 0;
    }
}

// weekLogs: this user's logs since the start of the week; claimedIds: Set of claimed challenge ids.
function computeChallenges(weekLogs, claimedIds, nowMs) {
    const { week, challenges } = weeklyChallenges(nowMs);
    return {
        week: { start: new Date(week.startMs).toISOString(), end: new Date(week.endMs).toISOString(), key: week.key },
        challenges: challenges.map(c => {
            const progress = Math.min(challengeProgress(c, weekLogs), c.target);
            return {
                id: c.id, slug: c.slug, metric: c.metric, wasteType: c.wasteType || null,
                target: c.target, bonus: c.bonus, progress,
                completed: progress >= c.target,
                claimed: claimedIds.has(c.id),
            };
        }),
    };
}

// League table for one group kind ('department' | 'hostel').
//   logs:     accepted waste_logs of the period ({ user_id, points })
//   profiles: [{ id, role, department, hostel }]
//   groups:   campus_groups rows of that kind
// Ranked by total points; ties broken by points per member, then items.
function computeStandings(kind, logs, profiles, groups) {
    const field = kind === 'hostel' ? 'hostel' : 'department';
    const groupOf = new Map();
    const members = new Map();
    for (const p of Array.isArray(profiles) ? profiles : []) {
        if (!p || p.role !== 'user' || !p[field]) continue;
        groupOf.set(p.id, p[field]);
        members.set(p[field], (members.get(p[field]) || 0) + 1);
    }
    const totals = new Map();
    for (const l of countable(logs)) {
        const g = groupOf.get(l.user_id);
        if (!g) continue;
        const t = totals.get(g) || { points: 0, items: 0, users: new Set() };
        t.points += Number(l.points) || 0;
        t.items += itemCount(l);
        t.users.add(l.user_id);
        totals.set(g, t);
    }
    const rows = (Array.isArray(groups) ? groups : [])
        .filter(g => g && g.kind === kind && g.active !== false)
        .map(g => {
            const t = totals.get(g.id) || { points: 0, items: 0, users: new Set() };
            const m = members.get(g.id) || 0;
            return {
                id: g.id, name: g.name, labels: g.labels || {},
                members: m, activeMembers: t.users.size,
                points: t.points, items: t.items,
                pointsPerMember: m ? Math.round(t.points / m) : 0,
            };
        })
        .sort((a, b) => b.points - a.points || b.pointsPerMember - a.pointsPerMember || b.items - a.items || a.name.localeCompare(b.name));
    let rank = 0;
    return rows.map((r, i) => {
        if (i === 0 || r.points !== rows[i - 1].points) rank = i + 1;
        return { ...r, rank };
    });
}

// Weekly individual table: [{ userId, name, points, items, department, hostel, rank }]
function computeIndividuals(logs, profiles, limit = 50) {
    const byId = new Map((Array.isArray(profiles) ? profiles : []).filter(p => p && p.role === 'user').map(p => [p.id, p]));
    const totals = new Map();
    for (const l of countable(logs)) {
        if (!byId.has(l.user_id)) continue;
        const t = totals.get(l.user_id) || { points: 0, items: 0 };
        t.points += Number(l.points) || 0;
        t.items += itemCount(l);
        totals.set(l.user_id, t);
    }
    const rows = [...totals.entries()]
        .map(([userId, t]) => {
            const p = byId.get(userId);
            return { userId, name: String(p.name || '').trim() || 'Eco-warrior', department: p.department || null, hostel: p.hostel || null, ...t };
        })
        .filter(r => r.points > 0)
        .sort((a, b) => b.points - a.points || b.items - a.items);
    let rank = 0;
    return rows.map((r, i) => {
        if (i === 0 || r.points !== rows[i - 1].points) rank = i + 1;
        return { ...r, rank };
    }).slice(0, limit);
}

module.exports = {
    IST_OFFSET_MS, istDayKey, istWeek,
    BADGES, CHALLENGE_POOL,
    computeStreak, userStats, computeBadges,
    weeklyChallenges, computeChallenges, challengeProgress,
    computeStandings, computeIndividuals,
};
