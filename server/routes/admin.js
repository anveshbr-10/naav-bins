// Operations console (admins), vendor management, and the voucher counter (admins + counter staff).

const { computeImpact, planRedemptionStatusChange, ADMIN_STATUSES, BIN_STREAMS } = require('../lib/rewards');
const { summarizeFleet, planCollectionRoute } = require('../lib/operations');
const { deriveDeviceKey } = require('../lib/binQr');
const {
    istDayStart, planCounterAccess, planVoucherAccess, planDailyLimit, parseVendorInput, summarizeSettlement, VENDOR_ID_RE,
} = require('../lib/vendors');
const { parsePaymentCode, effectiveStatus, planPaymentAccess, confirmError } = require('../lib/payments');
const { parseProgramInput, programView, normalizeProgram } = require('../lib/cashback');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CODE_RE = /^(NB-[A-Z0-9]{4}-[A-Z0-9]{4}|LEGACY-[A-Z0-9]{8})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v, { min = -Infinity, max = Infinity } = {}) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
};

module.exports = function adminRoutes(ctx) {
    const { app, supabase, store, config, fail, str, verifyToken, loadProfile, requireAdmin, requireCounter, limiters, caches } = ctx;
    const admin = [verifyToken, loadProfile, requireAdmin];
    const adminWrite = [...admin, limiters.write];

    // Counter staff: role 'vendor' AND linked to an active vendor (read fresh on every request).
    // Sets req.vendor (null for admins, who may act at any counter).
    async function loadCounter(req, res, next) {
        const vendor = req.profile && req.profile.role === 'vendor' ? await store.getVendor(req.profile.vendor_id) : null;
        const access = planCounterAccess(req.profile, vendor);
        if (access.reject) return fail(res, access.reject.code, access.reject.template, access.reject.params);
        req.vendor = access.vendor;
        next();
    }
    const counter = [verifyToken, loadProfile, requireCounter, loadCounter];

    // ---------------- overview ----------------
    app.get('/api/admin/overview', ...admin, async (req, res) => {
        const [profiles, material, redemptions, flags, tables] = await Promise.all([
            supabase.from('user_profiles').select('role, walletBalance, ecoPoints, is_blocked'),
            supabase.from('naav_user_material_stats').select('waste_type, items, weight_kg, measured_items, reward_inr'),
            supabase.from('redemptions').select('type, cost, status'),
            supabase.from('fraud_flags').select('severity').is('resolved_at', null),
            store.loadRewardTables(),
        ]);
        for (const r of [profiles, material, redemptions, flags]) if (r.error) throw r.error;
        const impact = computeImpact(material.data, tables.rules);
        const sum = (rows, pred) => rows.filter(pred).reduce((s, r) => s + (Number(r.cost) || 0), 0);
        res.json({
            status: 'ok',
            users: profiles.data.filter(p => p.role === 'user').length,
            admins: profiles.data.filter(p => p.role === 'admin').length,
            vendors: profiles.data.filter(p => p.role === 'vendor').length,
            blocked: profiles.data.filter(p => p.is_blocked).length,
            walletTotal: profiles.data.reduce((s, p) => s + (Number(p.walletBalance) || 0), 0),
            rewardsIssued: material.data.reduce((s, r) => s + (Number(r.reward_inr) || 0), 0),
            paidOut: sum(redemptions.data, r => r.type === 'money' && r.status === 'Paid'),
            pendingAmount: sum(redemptions.data, r => r.type === 'money' && r.status === 'Pending'),
            pendingCount: redemptions.data.filter(r => r.type === 'money' && r.status === 'Pending').length,
            openVouchers: redemptions.data.filter(r => r.type === 'points' && r.status === 'Issued').length,
            openFlags: flags.data.length,
            highFlags: flags.data.filter(f => f.severity === 'high').length,
            ...impact,
        });
    });

    // ---------------- users ----------------
    app.get('/api/admin/users', ...admin, async (req, res) => {
        const [users, material, open, flags, tables] = await Promise.all([
            supabase.from('user_profiles')
                .select('id, email, name, role, vendor_id, walletBalance, ecoPoints, department, hostel, is_blocked, createdAt')
                .order('createdAt', { ascending: true }),
            supabase.from('naav_user_material_stats').select('user_id, waste_type, items, weight_kg, measured_items, reward_inr'),
            supabase.from('redemptions').select('user_id, cost').eq('type', 'money').eq('status', 'Pending'),
            supabase.from('fraud_flags').select('user_id').is('resolved_at', null),
            store.loadRewardTables(),
        ]);
        for (const r of [users, material, open, flags]) if (r.error) throw r.error;
        const group = (rows, key) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) || []), r]), new Map());
        const byUser = group(material.data, 'user_id');
        const pending = group(open.data, 'user_id');
        const flagCount = group(flags.data, 'user_id');
        res.json({
            status: 'ok',
            users: users.data.map(u => {
                const rows = byUser.get(u.id) || [];
                return {
                    ...u,
                    impact: computeImpact(rows, tables.rules),
                    rewardsEarned: rows.reduce((s, r) => s + (Number(r.reward_inr) || 0), 0),
                    pendingWithdrawals: (pending.get(u.id) || []).reduce((s, r) => s + (Number(r.cost) || 0), 0),
                    openFlags: (flagCount.get(u.id) || []).length,
                };
            }),
        });
    });

    app.get('/api/admin/users/:id', ...admin, async (req, res) => {
        const id = req.params.id;
        if (!UUID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const [user, logs, redemptions, flags] = await Promise.all([
            supabase.from('user_profiles').select('id, email, name, role, vendor_id, walletBalance, ecoPoints, department, hostel, is_blocked, createdAt').eq('id', id).maybeSingle(),
            supabase.from('waste_logs').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(100),
            supabase.from('redemptions').select('*').eq('user_id', id).order('created_at', { ascending: false }),
            supabase.from('fraud_flags').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
        ]);
        for (const r of [user, logs, redemptions, flags]) if (r.error) throw r.error;
        if (!user.data) return fail(res, 404, 'User not found');
        res.json({ status: 'ok', user: user.data, logs: logs.data, redemptions: redemptions.data, flags: flags.data });
    });

    // Pause / resume a user's ability to earn (e.g. after confirmed fraud).
    app.post('/api/admin/users/:id/block', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        if (!UUID_RE.test(id) || typeof (req.body && req.body.blocked) !== 'boolean') return fail(res, 400, 'Invalid request');
        if (id === req.user.id) return fail(res, 400, 'You cannot change your own account here.');
        const { data, error } = await supabase.from('user_profiles').update({ is_blocked: req.body.blocked }).eq('id', id).select('id, is_blocked').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'User not found');
        res.json({ status: 'ok', user: data });
    });

    // Give canteen / store staff the "vendor" role for ONE active counter (counter page only), or take it away.
    app.post('/api/admin/users/:id/role', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        const role = req.body && req.body.role;
        if (!UUID_RE.test(id) || !['user', 'vendor'].includes(role)) return fail(res, 400, 'Invalid request');
        if (id === req.user.id) return fail(res, 400, 'You cannot change your own account here.');
        let vendorId = null;
        if (role === 'vendor') {
            vendorId = str(req.body.vendorId);
            if (!VENDOR_ID_RE.test(vendorId)) return fail(res, 400, 'Choose the counter this person works at.');
            const vendor = await store.getVendor(vendorId);
            if (!vendor) return fail(res, 404, 'Vendor not found');
            if (!vendor.active) return fail(res, 400, 'This counter is switched off. Switch it on first.');
        }
        const { data, error } = await supabase.from('user_profiles').update({ role, vendor_id: vendorId })
            .eq('id', id).neq('role', 'admin').select('id, role, vendor_id').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'User not found');
        caches.leagues.clear();
        res.json({ status: 'ok', user: data });
    });

    // ---------------- redemptions ----------------
    app.get('/api/admin/redemptions', ...admin, async (req, res) => {
        let q = supabase.from('redemptions').select('*, user_profiles(name, email)').order('created_at', { ascending: true }).limit(1000);
        if (req.query.scope !== 'all') q = q.in('status', ['Pending', 'Issued']);
        const { data, error } = await q;
        if (error) throw error;
        res.json({
            status: 'ok',
            redemptions: (data || []).map(({ user_profiles: u, ...r }) => ({ ...r, userName: u ? u.name : null, userEmail: u ? u.email : null })),
        });
    });

    // Pending -> Paid / Rejected (withdrawals), Issued -> Claimed / Cancelled (vouchers).
    // Rejected / Cancelled refund the user. Each decision applies once (status guard in SQL).
    async function decide(req, res, code, status, vendorId = null) {
        if (!CODE_RE.test(code) || !ADMIN_STATUSES.includes(status)) return fail(res, 400, 'Invalid request');
        const outcome = await store.changeRedemptionStatus(code, r => planRedemptionStatusChange(r, { status, vendorId }), req.user.email);
        if (outcome.outcome === 'not_found') return fail(res, 404, 'Redemption not found');
        if (outcome.outcome === 'rejected') return fail(res, outcome.code, outcome.template || outcome.message, outcome.params);
        if (outcome.outcome === 'conflict') return fail(res, 409, 'This redemption was already processed. Please refresh.');
        caches.stats = null;
        return res.json({ status: 'ok', redemption: outcome.result });
    }

    app.post('/api/admin/redemptions/status', ...adminWrite, (req, res) =>
        decide(req, res, str(req.body && req.body.code), req.body && req.body.status));

    // ---------------- voucher counter (canteen / store staff) ----------------
    // Staff see and claim only vouchers issued for their own counter, up to its daily limit.
    const vendorView = v => (v ? {
        id: v.id, name: v.name, category: v.category, location: v.location, labels: v.labels, dailyClaimLimit: v.daily_claim_limit,
        maxTxnInr: v.max_txn_inr ?? null, dailyLimitInr: v.daily_limit_inr ?? null,
    } : null);

    app.get('/api/counter/me', ...counter, async (req, res) => {
        const since = istDayStart(Date.now());
        const claims = await store.vendorClaimsSince(req.vendor ? req.vendor.id : null, since);
        let pq = supabase.from('vendor_payments')
            .select('code, amount_inr, completed_at, user_profiles!vendor_payments_user_id_fkey(name)')
            .eq('status', 'Completed').gte('completed_at', new Date(since).toISOString())
            .order('completed_at', { ascending: false }).limit(200);
        if (req.vendor) pq = pq.eq('vendor_id', req.vendor.id);
        const { data: pays, error: payError } = await pq;
        // Before 004 is run the table is missing: show vouchers only.
        const payments = payError ? [] : (pays || []).map(({ user_profiles: u, ...p }) => ({ ...p, userName: u ? u.name : null }));
        res.json({
            status: 'ok',
            vendor: vendorView(req.vendor),
            today: claims.map(({ user_profiles: u, ...c }) => ({ ...c, userName: u ? u.name : null })),
            payments,
            paymentsInr: payments.reduce((s, p) => s + (Number(p.amount_inr) || 0), 0),
        });
    });

    app.get('/api/counter/voucher/:code', ...counter, async (req, res) => {
        const code = str(req.params.code).toUpperCase();
        if (!CODE_RE.test(code)) return fail(res, 400, 'Enter a code like NB-ABCD-2345.');
        const { data, error } = await supabase.from('redemptions')
            .select('code, item, type, cost, status, vendor, vendor_id, created_at, processed_at, processed_by, user_profiles(name)')
            .eq('code', code).maybeSingle();
        if (error) throw error;
        const access = planVoucherAccess(data, req.vendor);
        if (access.reject) return fail(res, access.reject.code, access.reject.template, access.reject.params);
        const { user_profiles: u, ...voucher } = data;
        res.json({ status: 'ok', voucher: { ...voucher, userName: u ? u.name : null } });
    });

    app.post('/api/counter/voucher/:code/claim', ...counter, limiters.write, async (req, res) => {
        if (req.vendor) {
            const claimedToday = await store.vendorClaimsSince(req.vendor.id, istDayStart(Date.now()), { countOnly: true });
            const limit = planDailyLimit(req.vendor, claimedToday);
            if (limit.reject) return fail(res, limit.reject.code, limit.reject.template, limit.reject.params);
        }
        return decide(req, res, str(req.params.code).toUpperCase(), 'Claimed', req.vendor ? req.vendor.id : null);
    });

    // ---------------- campus-wallet payments at the counter ----------------
    async function loadPayment(code) {
        const { data, error } = await supabase.from('vendor_payments')
            .select('code, vendor_id, amount_inr, points, status, expires_at, created_at, completed_at, staff_email, vendors(name), user_profiles!vendor_payments_user_id_fkey(name)')
            .eq('code', code).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        const { vendors: v, user_profiles: u, ...p } = data;
        return { ...p, vendor_name: v ? v.name : null, userName: u ? u.name : null };
    }

    app.get('/api/counter/payment/:code', ...counter, async (req, res) => {
        const code = parsePaymentCode(req.params.code);
        if (!code) return fail(res, 400, 'Enter a code like NP-ABCD-2345.');
        const payment = await loadPayment(code);
        const access = planPaymentAccess(payment, req.vendor);
        if (access.reject) return fail(res, access.reject.code, access.reject.template, access.reject.params);
        res.json({ status: 'ok', payment: { ...payment, status: effectiveStatus(payment, Date.now()) } });
    });

    app.post('/api/counter/payment/:code/confirm', ...counter, limiters.write, async (req, res) => {
        const code = parsePaymentCode(req.params.code);
        if (!code) return fail(res, 400, 'Enter a code like NP-ABCD-2345.');
        const { data, error } = await supabase.rpc('naav_confirm_payment', {
            p_code: code, p_vendor: req.vendor ? req.vendor.id : null, p_staff: req.user.id, p_staff_email: req.user.email,
        });
        if (error) throw error;
        const err = confirmError(data);
        if (err) return fail(res, err.code, err.template);
        caches.stats = null;
        res.json({ status: 'ok', payment: await loadPayment(code) });
    });

    // ---------------- vendors (campus counters) ----------------
    app.get('/api/admin/vendors', ...admin, async (req, res) => {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
        const since = new Date(Date.now() - days * DAY_MS).toISOString();
        const [program, pays] = await Promise.all([
            store.loadProgram(),
            supabase.from('vendor_payments').select('vendor_id, amount_inr').eq('status', 'Completed').gte('completed_at', since).limit(100000),
        ]);
        const [vendors, staff, claims, open] = await Promise.all([
            supabase.from('vendors').select('*').order('sort').order('name'),
            supabase.from('user_profiles').select('id, name, email, vendor_id').eq('role', 'vendor'),
            supabase.from('redemptions').select('vendor_id, cost').eq('type', 'points').eq('status', 'Claimed').gte('processed_at', since).limit(100000),
            supabase.from('redemptions').select('vendor_id').eq('type', 'points').eq('status', 'Issued').limit(100000),
        ]);
        for (const r of [vendors, staff, claims, open]) if (r.error) throw r.error;
        const settlement = new Map(summarizeSettlement(vendors.data, claims.data, program.pointsPerRupee, pays.error ? [] : pays.data).map(s => [s.vendorId, s]));
        res.json({
            status: 'ok',
            days,
            pointsPerRupee: program.pointsPerRupee,
            vendors: vendors.data.map(v => ({
                ...v,
                staff: staff.data.filter(s => s.vendor_id === v.id).map(s => ({ id: s.id, name: s.name, email: s.email })),
                openVouchers: open.data.filter(o => o.vendor_id === v.id).length,
                settlement: settlement.get(v.id),
            })),
        });
    });

    app.post('/api/admin/vendors', ...adminWrite, async (req, res) => {
        const parsed = parseVendorInput(req.body);
        if (parsed.reject) return fail(res, parsed.reject.code, parsed.reject.template, parsed.reject.params);
        const { data, error } = await supabase.from('vendors').insert([parsed.values]).select('*').maybeSingle();
        if (error && error.code === '23505') return fail(res, 409, 'A vendor with this ID already exists.');
        if (error) throw error;
        res.json({ status: 'ok', vendor: data });
    });

    app.post('/api/admin/vendors/:id', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        if (!VENDOR_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const parsed = parseVendorInput(req.body, { partial: true });
        if (parsed.reject) return fail(res, parsed.reject.code, parsed.reject.template, parsed.reject.params);
        const { data, error } = await supabase.from('vendors')
            .update({ ...parsed.values, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Vendor not found');
        if (parsed.values.name) {
            // Keep the "claim at" name on catalogue items in step (translations are edited in the database).
            const { error: e2 } = await supabase.from('reward_catalog').update({ vendor: data.name }).eq('vendor_id', id);
            if (e2) throw e2;
            store.invalidateRewardTables();
        }
        res.json({ status: 'ok', vendor: data });
    });

    // ---------------- fleet operations ----------------
    async function loadFleet(days) {
        const now = Date.now();
        const since = new Date(now - Math.max(days, 30) * DAY_MS).toISOString();
        const [bins, logs, collections, flags] = await Promise.all([
            supabase.from('bins').select('*').order('name'),
            supabase.from('waste_logs')
                .select('bin_id, user_id, accepted, reject_reason, created_at, est_weight_kg, measured_weight_kg')
                .gte('created_at', since).limit(100000),
            supabase.from('bin_collections').select('*').order('collected_at', { ascending: false }).limit(2000),
            supabase.from('fraud_flags').select('bin_id').is('resolved_at', null),
        ]);
        for (const r of [bins, logs, collections, flags]) if (r.error) throw r.error;
        // Fill estimates need everything since the last emptying (up to 30 days); rates use the window.
        const windowStart = now - days * DAY_MS;
        const fleet = summarizeFleet({ bins: bins.data, logs: logs.data, collections: collections.data, flags: flags.data, nowMs: now });
        const windowed = summarizeFleet({
            bins: bins.data, logs: logs.data.filter(l => Date.parse(l.created_at) >= windowStart),
            collections: collections.data, flags: flags.data, nowMs: now,
        });
        const merged = fleet.bins.map((b, i) => ({
            ...windowed.bins[i],
            fill: b.fill,
        }));
        return { bins: merged, totals: { ...windowed.totals, nearlyFull: merged.filter(b => b.fill.level >= 80).length }, rawBins: bins.data };
    }

    app.get('/api/admin/ops', ...admin, async (req, res) => {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
        const { bins, totals } = await loadFleet(days);
        res.json({ status: 'ok', days, bins, totals, depot: config.DEPOT, qrPeriod: config.DYNAMIC_QR_PERIOD_S });
    });

    app.get('/api/admin/ops/route', ...admin, async (req, res) => {
        const threshold = Math.min(100, Math.max(0, parseInt(req.query.threshold, 10) || 70));
        const lat = num(req.query.lat, { min: -90, max: 90 });
        const lng = num(req.query.lng, { min: -180, max: 180 });
        const depot = Number.isFinite(lat) && Number.isFinite(lng) && lat !== null && lng !== null ? { lat, lng } : config.DEPOT;
        const { bins } = await loadFleet(7);
        res.json({ status: 'ok', threshold, ...planCollectionRoute(bins, { threshold, depot }) });
    });

    // Update a bin's settings.
    app.post('/api/admin/bins/:id', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        if (!BIN_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const b = req.body || {};
        const changes = {};
        if ('status' in b) {
            if (!['Active', 'Full', 'Inactive'].includes(b.status)) return fail(res, 400, 'Invalid request');
            changes.status = b.status;
        }
        if ('stream' in b) {
            if (!BIN_STREAMS.includes(b.stream)) return fail(res, 400, 'Invalid request');
            changes.stream = b.stream;
        }
        if ('qrMode' in b) {
            if (!['static', 'dynamic'].includes(b.qrMode)) return fail(res, 400, 'Invalid request');
            changes.qr_mode = b.qrMode;
        }
        if ('capacityItems' in b) {
            const n = num(b.capacityItems, { min: 1, max: 100000 });
            if (!Number.isInteger(n)) return fail(res, 400, 'Invalid request');
            changes.capacity_items = n;
        }
        if ('zone' in b) changes.zone = str(b.zone).slice(0, 60) || null;
        if ('fillLevel' in b) {
            const n = num(b.fillLevel, { min: 0, max: 100 });
            if (!Number.isFinite(n)) return fail(res, 400, 'Invalid request');
            Object.assign(changes, { fill_level: n, fill_source: 'manual', fill_updated_at: new Date().toISOString() });
        }
        if (!Object.keys(changes).length) return fail(res, 400, 'Nothing to update.');
        const { data, error } = await supabase.from('bins').update(changes).eq('id', id).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'This bin is not registered.');
        caches.stats = null;
        res.json({ status: 'ok', bin: data });
    });

    // Record a collection: resets the fill level, logs weight and audited contamination.
    app.post('/api/admin/bins/:id/empty', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        if (!BIN_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const b = req.body || {};
        const weight = num(b.measuredWeightKg, { min: 0, max: 5000 });
        const contamination = num(b.contaminationPct, { min: 0, max: 100 });
        if (Number.isNaN(weight) || Number.isNaN(contamination)) return fail(res, 400, 'Invalid request');

        const { bins } = await loadFleet(7);
        const current = bins.find(x => String(x.id) === id);
        if (!current) return fail(res, 404, 'This bin is not registered.');
        const now = new Date().toISOString();
        const { error: insertError } = await supabase.from('bin_collections').insert([{
            bin_id: id,
            collected_by: req.user.email,
            fill_level_before: current.fill.level,
            items_since_last: Math.round((current.fill.level / 100) * (current.capacityItems || 200)),
            measured_weight_kg: weight,
            contamination_pct: contamination,
            notes: str(b.notes).slice(0, 500) || null,
        }]);
        if (insertError) throw insertError;
        const changes = { last_emptied_at: now, fill_level: 0, fill_source: 'manual', fill_updated_at: now };
        if (current.status === 'Full') changes.status = 'Active';
        const { error } = await supabase.from('bins').update(changes).eq('id', id);
        if (error) throw error;
        res.json({ status: 'ok' });
    });

    app.get('/api/admin/bins/:id/collections', ...admin, async (req, res) => {
        const id = req.params.id;
        if (!BIN_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const { data, error } = await supabase.from('bin_collections').select('*').eq('bin_id', id).order('collected_at', { ascending: false }).limit(50);
        if (error) throw error;
        res.json({ status: 'ok', collections: data });
    });

    // Device provisioning for the bin's screen (rotating QR) and sensors (fill level, scale).
    app.get('/api/admin/bins/:id/device', ...admin, async (req, res) => {
        const id = req.params.id;
        if (!BIN_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        if (!config.QR_SECRET) return fail(res, 503, 'Bin verification is not configured on the server.');
        const { data: bin, error } = await supabase.from('bins').select('id, name, device_key_version, qr_mode').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!bin) return fail(res, 404, 'This bin is not registered.');
        const keyVersion = Number(bin.device_key_version || 1);
        res.json({
            status: 'ok',
            binId: String(bin.id),
            name: bin.name,
            qrMode: bin.qr_mode,
            keyVersion,
            deviceKey: deriveDeviceKey(config.QR_SECRET, bin.id, keyVersion),
            period: config.DYNAMIC_QR_PERIOD_S,
        });
    });

    // Invalidate the bin's current device key (lost / tampered screen). Old rotating codes stop working.
    app.post('/api/admin/bins/:id/rotate-key', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        if (!BIN_ID_RE.test(id)) return fail(res, 400, 'Invalid request');
        const { data: bin, error } = await supabase.from('bins').select('device_key_version').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!bin) return fail(res, 404, 'This bin is not registered.');
        const next = Number(bin.device_key_version || 1) + 1;
        const { error: updateError } = await supabase.from('bins').update({ device_key_version: next }).eq('id', id).eq('device_key_version', bin.device_key_version);
        if (updateError) throw updateError;
        res.json({ status: 'ok', keyVersion: next });
    });

    // ---------------- fraud flags ----------------
    app.get('/api/admin/flags', ...admin, async (req, res) => {
        let q = supabase.from('fraud_flags').select('*, user_profiles(name, email, is_blocked)').order('created_at', { ascending: false }).limit(500);
        if (req.query.scope !== 'all') q = q.is('resolved_at', null);
        const { data, error } = await q;
        if (error) throw error;
        res.json({
            status: 'ok',
            flags: (data || []).map(({ user_profiles: u, ...f }) => ({
                ...f, userName: u ? u.name : null, userEmail: u ? u.email : null, userBlocked: u ? u.is_blocked : null,
            })),
        });
    });

    app.post('/api/admin/flags/:id/resolve', ...adminWrite, async (req, res) => {
        const id = req.params.id;
        const resolution = req.body && req.body.resolution;
        if (!UUID_RE.test(id) || !['dismissed', 'confirmed'].includes(resolution)) return fail(res, 400, 'Invalid request');
        const { data, error } = await supabase.from('fraud_flags')
            .update({ resolution, resolved_at: new Date().toISOString(), resolved_by: req.user.email })
            .eq('id', id).is('resolved_at', null).select('id, user_id').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 409, 'This flag was already resolved. Please refresh.');
        if (resolution === 'confirmed' && req.body.blockUser === true && data.user_id && data.user_id !== req.user.id) {
            const { error: blockError } = await supabase.from('user_profiles').update({ is_blocked: true }).eq('id', data.user_id);
            if (blockError) throw blockError;
        }
        res.json({ status: 'ok' });
    });

    // ---------------- campus-wallet payments (admin) ----------------
    app.get('/api/admin/payments', ...admin, async (req, res) => {
        let q = supabase.from('vendor_payments')
            .select('code, vendor_id, amount_inr, points, status, expires_at, created_at, completed_at, staff_email, refunded_at, refunded_by, vendors(name), user_profiles!vendor_payments_user_id_fkey(name, email)')
            .order('created_at', { ascending: false }).limit(500);
        if (req.query.scope !== 'all') q = q.eq('status', 'Completed');
        const { data, error } = await q;
        if (error) throw error;
        const now = Date.now();
        res.json({
            status: 'ok',
            payments: (data || []).map(({ vendors: v, user_profiles: u, ...p }) => ({
                ...p, status: effectiveStatus(p, now), vendorName: v ? v.name : null, userName: u ? u.name : null, userEmail: u ? u.email : null,
            })),
        });
    });

    app.post('/api/admin/payments/:code/refund', ...adminWrite, async (req, res) => {
        const code = parsePaymentCode(req.params.code);
        if (!code) return fail(res, 400, 'Invalid request');
        const { data, error } = await supabase.rpc('naav_refund_payment', { p_code: code, p_actor: req.user.email });
        if (error) throw error;
        if (data !== 'ok') return fail(res, 409, 'Only a completed payment can be refunded, once.');
        caches.stats = null;
        res.json({ status: 'ok' });
    });

    // ---------------- reward programme (campus wallet + cashback) ----------------
    app.get('/api/admin/program', ...admin, async (req, res) => {
        const program = await store.loadProgram();
        const since = istDayStart(Date.now());
        const bonusToday = program.legacy ? 0 : await store.bonusSpentSince(since);
        res.json({ status: 'ok', program: programView(program), bonusToday });
    });

    app.post('/api/admin/program', ...adminWrite, async (req, res) => {
        const parsed = parseProgramInput(req.body);
        if (parsed.reject) return fail(res, parsed.reject.code, parsed.reject.template, parsed.reject.params);
        const { data, error } = await supabase.from('reward_program')
            .update({ ...parsed.values, updated_at: new Date().toISOString() }).eq('id', 1).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 503, 'Run server/supabase/004_wallet_cashback.sql first.');
        store.invalidateRewardTables();
        res.json({ status: 'ok', program: programView(normalizeProgram(data)) });
    });

    // ---------------- reward table (database) ----------------
    app.get('/api/admin/rewards', ...admin, async (req, res) => {
        const [rules, catalog] = await Promise.all([
            supabase.from('reward_rules').select('*').order('sort'),
            supabase.from('reward_catalog').select('*').order('sort'),
        ]);
        if (rules.error) throw rules.error;
        if (catalog.error) throw catalog.error;
        res.json({ status: 'ok', rules: rules.data, catalog: catalog.data });
    });

    app.post('/api/admin/rewards/rule', ...adminWrite, async (req, res) => {
        const b = req.body || {};
        const wasteType = str(b.wasteType);
        const reward = num(b.rewardInr, { min: 0, max: 10000 });
        const points = num(b.points, { min: 0, max: 100000 });
        if (!wasteType || !Number.isInteger(reward) || !Number.isInteger(points) || typeof b.active !== 'boolean') return fail(res, 400, 'Invalid request');
        const { data, error } = await supabase.from('reward_rules')
            .update({ reward_inr: reward, points, active: b.active, updated_at: new Date().toISOString() })
            .eq('waste_type', wasteType).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Unknown waste type');
        store.invalidateRewardTables();
        res.json({ status: 'ok', rule: data });
    });

    app.post('/api/admin/rewards/item', ...adminWrite, async (req, res) => {
        const b = req.body || {};
        const item = str(b.item);
        const cost = num(b.cost, { min: 1, max: 1000000 });
        if (!item || !Number.isInteger(cost) || typeof b.active !== 'boolean') return fail(res, 400, 'Invalid request');
        const { data, error } = await supabase.from('reward_catalog')
            .update({ cost, active: b.active, updated_at: new Date().toISOString() })
            .eq('item', item).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Unknown reward item');
        store.invalidateRewardTables();
        res.json({ status: 'ok', item: data });
    });
};
