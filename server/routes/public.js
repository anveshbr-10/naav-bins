// Public, read-only endpoints (no sign-in). Aggregates only — no personal data beyond display names.

const { publicCatalog, computeImpact } = require('../lib/rewards');
const { istWeek, computeStandings, computeIndividuals } = require('../lib/leagues');
const { binFill } = require('../lib/operations');
const { checkEmail } = require('../lib/emailCheck');

const MIN = 60 * 1000;

module.exports = function publicRoutes(ctx) {
    const { app, supabase, store, fail, caches, limiters } = ctx;

    // REGISTRATION EMAIL CHECK: format, typos, throwaway inboxes and whether the domain receives mail.
    // Runs before Supabase sends the confirmation link, so dummy addresses never get one.
    app.post('/api/auth/check-email', limiters.emailCheck, async (req, res) => {
        const result = await checkEmail(req.body && req.body.email);
        if (result.ok) return res.json({ status: 'ok' });
        if (result.reason === 'typo') return fail(res, 400, 'Did you mean {suggestion}? Please check the spelling of your email address.', { suggestion: result.suggestion });
        if (result.reason === 'disposable') return fail(res, 400, 'Temporary or throwaway email addresses are not allowed. Please use your own email.');
        if (result.reason === 'no_mail') return fail(res, 400, 'This email domain cannot receive mail. Please check your email address.');
        return fail(res, 400, 'Please enter a valid email address.');
    });

    // REWARD TABLE + CATALOGUE: read from the database (single source of truth).
    app.get('/api/rewards/catalog', async (req, res) => {
        try {
            const { rules, catalog } = await store.loadRewardTables();
            res.json({ status: 'ok', ...publicCatalog(rules, catalog) });
        } catch (err) {
            console.error('Catalog error:', err);
            return fail(res, 503, 'Rewards are unavailable right now. Please try again shortly.');
        }
    });

    // Departments and hostels users can join.
    app.get('/api/campus-groups', async (req, res) => {
        const { data, error } = await supabase.from('campus_groups').select('id, kind, name, labels, sort').eq('active', true).order('sort');
        if (error) throw error;
        res.json({ status: 'ok', groups: data || [] });
    });

    // PUBLIC IMPACT STATS (landing/about pages). Cached briefly.
    app.get('/api/stats', async (req, res) => {
        if (!caches.stats || caches.stats.expires <= Date.now()) {
            const [users, material, bins, tables] = await Promise.all([
                supabase.from('user_profiles').select('role'),
                supabase.from('naav_user_material_stats').select('waste_type, items, weight_kg, measured_items, reward_inr'),
                supabase.from('bins').select('status'),
                store.loadRewardTables(),
            ]);
            for (const r of [users, material, bins]) if (r.error) throw r.error;
            const impact = computeImpact(material.data, tables.rules);
            caches.stats = {
                expires: Date.now() + 5 * MIN,
                value: {
                    users: users.data.filter(u => u.role === 'user').length,
                    items: impact.items,
                    wasteKg: impact.wasteKg,
                    co2Kg: impact.co2Kg,
                    measuredItems: impact.measuredItems,
                    rewardsIssued: material.data.reduce((s, r) => s + (Number(r.reward_inr) || 0), 0),
                    bins: bins.data.length,
                    activeBins: bins.data.filter(b => b.status === 'Active').length,
                },
            };
        }
        res.json({ status: 'ok', ...caches.stats.value });
    });

    // BINS (public: locations, status, stream and approximate fill level).
    app.get('/api/bins', async (req, res) => {
        const { data: bins, error } = await supabase.from('bins')
            .select('id, name, lat, lng, status, stream, capacity_items, fill_level, fill_source, fill_updated_at, last_emptied_at');
        if (error) throw error;
        // Estimated fill needs item counts since each bin was last emptied (last 30 days is plenty).
        const since = new Date(Date.now() - 30 * 24 * 60 * MIN).toISOString();
        const { data: logs, error: logsError } = await supabase.from('waste_logs')
            .select('bin_id, created_at').eq('accepted', true).gte('created_at', since).limit(50000);
        if (logsError) throw logsError;
        const now = Date.now();
        const counts = new Map();
        const emptied = new Map(bins.map(b => [String(b.id), Date.parse(b.last_emptied_at) || 0]));
        for (const l of logs || []) {
            const id = String(l.bin_id);
            if (Date.parse(l.created_at) > (emptied.get(id) || 0)) counts.set(id, (counts.get(id) || 0) + 1);
        }
        res.json({
            status: 'ok',
            bins: bins.map(b => ({
                id: b.id, name: b.name, lat: b.lat, lng: b.lng, status: b.status,
                stream: b.stream || 'station',
                fill: binFill(b, counts.get(String(b.id)) || 0, now).level,
            })),
        });
    });

    // ALL-TIME INDIVIDUAL LEADERBOARD (public: names and points only)
    app.get('/api/leaderboard', async (req, res) => {
        const { data: leaders, error } = await supabase
            .from('user_profiles')
            .select('name, ecoPoints')
            .eq('role', 'user')
            .gt('ecoPoints', 0)
            .order('ecoPoints', { ascending: false })
            .limit(50);
        if (error) throw error;
        const leaderboard = leaders.map(l => ({ name: (l.name || '').trim() || 'Eco-warrior', ecoPoints: l.ecoPoints }));
        res.json({ status: 'ok', leaderboard });
    });

    // CAMPUS LEAGUES: department vs department, hostel vs hostel, and individuals.
    // period=week (this IST week, Monday start) or period=all.
    app.get('/api/leagues', async (req, res) => {
        const period = req.query.period === 'all' ? 'all' : 'week';
        const value = await getLeagues(ctx, period);
        res.json({
            status: 'ok',
            period,
            week: value.week,
            departments: value.departments,
            hostels: value.hostels,
            // Public view: no account ids.
            individuals: value.individuals.slice(0, 50).map(({ userId, ...rest }) => rest), // eslint-disable-line no-unused-vars
        });
    });
};

// Shared with the dashboard (personal rank). Cached for a minute per period.
async function getLeagues(ctx, period) {
    const { supabase, caches } = ctx;
    const hit = caches.leagues.get(period);
    if (hit && hit.expires > Date.now()) return hit.value;

    const week = istWeek(Date.now());
    let logsQuery;
    if (period === 'week') {
        logsQuery = supabase.from('waste_logs').select('user_id, points, accepted, created_at')
            .eq('accepted', true).gte('created_at', new Date(week.startMs).toISOString()).limit(100000);
    } else {
        logsQuery = supabase.from('naav_user_material_stats').select('user_id, points, items');
    }
    const [logs, profiles, groups] = await Promise.all([
        logsQuery,
        supabase.from('user_profiles').select('id, name, role, department, hostel'),
        supabase.from('campus_groups').select('id, kind, name, labels, active, sort'),
    ]);
    for (const r of [logs, profiles, groups]) if (r.error) throw r.error;

    const value = {
        week: { start: new Date(week.startMs).toISOString(), end: new Date(week.endMs).toISOString(), key: week.key },
        departments: computeStandings('department', logs.data, profiles.data, groups.data),
        hostels: computeStandings('hostel', logs.data, profiles.data, groups.data),
        individuals: computeIndividuals(logs.data, profiles.data, 500),
    };
    caches.leagues.set(period, { value, expires: Date.now() + MIN });
    return value;
}

module.exports.getLeagues = getLeagues;
