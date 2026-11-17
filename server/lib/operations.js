// Fleet metrics for the operations console. Pure functions: no I/O.

const { optimizeRoute, isLatLng } = require('./geo');

const HOUR_MS = 60 * 60 * 1000;
const SENSOR_FRESH_MS = 6 * HOUR_MS;

// Fill level (0–100) of a bin. A recent reading from the bin's sensor wins; then a recent manual
// reading; otherwise it is estimated from items deposited since the bin was last emptied.
function binFill(bin, itemsSinceEmptied, nowMs) {
    const fill = rawBinFill(bin, itemsSinceEmptied, nowMs);
    // A bin an operator has marked Full is full, whatever the estimate says, so the fill bar,
    // map colour and collection route all agree with the status badge.
    if (bin.status === 'Full' && fill.level < 100) {
        return { level: 100, source: 'manual', updatedAt: bin.fill_updated_at || null };
    }
    return fill;
}

function rawBinFill(bin, itemsSinceEmptied, nowMs) {
    const updated = Date.parse(bin.fill_updated_at);
    const age = Number.isFinite(updated) ? nowMs - updated : Infinity;
    const level = Number(bin.fill_level);
    if (Number.isFinite(level) && bin.fill_source === 'sensor' && age <= SENSOR_FRESH_MS) {
        return { level: Math.round(level), source: 'sensor', updatedAt: bin.fill_updated_at };
    }
    const capacity = Number(bin.capacity_items) > 0 ? Number(bin.capacity_items) : 200;
    const estimate = Math.min(100, Math.round((itemsSinceEmptied / capacity) * 100));
    // An operator's reading holds until the bin is emptied; deposits since can only raise it.
    if (Number.isFinite(level) && bin.fill_source === 'manual' && Number.isFinite(updated)) {
        if (estimate > level) return { level: estimate, source: 'estimate', updatedAt: null };
        return { level: Math.round(level), source: 'manual', updatedAt: bin.fill_updated_at };
    }
    return { level: estimate, source: 'estimate', updatedAt: null };
}

// Per-bin metrics.
//   bins:        rows of public.bins
//   logs:        waste_logs of the reporting window ({ bin_id, accepted, reject_reason, created_at, user_id,
//                measured_weight_kg, est_weight_kg })
//   collections: bin_collections rows, newest first
//   flags:       open fraud_flags ({ bin_id })
function summarizeFleet({ bins, logs, collections, flags, nowMs }) {
    const byBin = new Map();
    const lastEmptied = new Map();
    for (const b of bins) lastEmptied.set(String(b.id), Date.parse(b.last_emptied_at) || 0);

    for (const l of Array.isArray(logs) ? logs : []) {
        const id = String(l.bin_id);
        const m = byBin.get(id) || { total: 0, accepted: 0, wrong: 0, sinceEmptied: 0, users: new Set(), measuredKg: 0, estKg: 0, lastActivity: 0 };
        const t = Date.parse(l.created_at);
        m.total++;
        if (l.accepted === false) {
            if (l.reject_reason === 'wrong_stream') m.wrong++;
        } else {
            m.accepted++;
            if (t > (lastEmptied.get(id) || 0)) m.sinceEmptied++;
            if (l.measured_weight_kg !== null && l.measured_weight_kg !== undefined) m.measuredKg += Number(l.measured_weight_kg) || 0;
            else m.estKg += Number(l.est_weight_kg) || 0;
        }
        m.users.add(l.user_id);
        if (t > m.lastActivity) m.lastActivity = t;
        byBin.set(id, m);
    }

    const lastAudit = new Map();
    for (const c of Array.isArray(collections) ? collections : []) {
        const id = String(c.bin_id);
        if (!lastAudit.has(id) && c.contamination_pct !== null && c.contamination_pct !== undefined) lastAudit.set(id, c);
    }
    const openFlags = new Map();
    for (const f of Array.isArray(flags) ? flags : []) {
        if (f.bin_id === null || f.bin_id === undefined) continue;
        openFlags.set(String(f.bin_id), (openFlags.get(String(f.bin_id)) || 0) + 1);
    }

    const round1 = n => Math.round(n * 10) / 10;
    const rows = bins.map(b => {
        const id = String(b.id);
        const m = byBin.get(id) || { total: 0, accepted: 0, wrong: 0, sinceEmptied: 0, users: new Set(), measuredKg: 0, estKg: 0, lastActivity: 0 };
        const audit = lastAudit.get(id);
        return {
            id: b.id,
            name: b.name,
            lat: b.lat,
            lng: b.lng,
            status: b.status,
            stream: b.stream || 'station',
            zone: b.zone || null,
            qrMode: b.qr_mode || 'static',
            capacityItems: b.capacity_items,
            fill: binFill(b, m.sinceEmptied, nowMs),
            lastEmptiedAt: b.last_emptied_at || null,
            lastSeenAt: b.last_seen_at || null,
            items: m.accepted,
            identifications: m.total,
            wrongStream: m.wrong,
            // Share of items identified at this bin that belonged in a different stream.
            contaminationRate: m.total ? round1((m.wrong / m.total) * 100) : null,
            auditedContamination: audit ? { pct: Number(audit.contamination_pct), at: audit.collected_at } : null,
            activeUsers: m.users.size,
            weightKg: round1(m.measuredKg + m.estKg),
            measuredKg: round1(m.measuredKg),
            lastActivityAt: m.lastActivity ? new Date(m.lastActivity).toISOString() : null,
            openFlags: openFlags.get(id) || 0,
        };
    });

    const totals = rows.reduce((t, r) => {
        t.items += r.items;
        t.identifications += r.identifications;
        t.wrongStream += r.wrongStream;
        t.weightKg += r.weightKg;
        t.measuredKg += r.measuredKg;
        if (r.fill.level >= 80) t.nearlyFull++;
        if (r.status === 'Active') t.active++;
        return t;
    }, { bins: rows.length, active: 0, nearlyFull: 0, items: 0, identifications: 0, wrongStream: 0, weightKg: 0, measuredKg: 0 });
    totals.contaminationRate = totals.identifications ? round1((totals.wrongStream / totals.identifications) * 100) : null;
    totals.weightKg = round1(totals.weightKg);
    totals.measuredKg = round1(totals.measuredKg);

    return { bins: rows, totals };
}

// Bins that need emptying (fill >= threshold, or marked Full), in an optimised visiting order from the depot.
function planCollectionRoute(fleetBins, { threshold = 70, depot }) {
    const due = fleetBins.filter(b => isLatLng(b) && (b.fill.level >= threshold || b.status === 'Full'));
    if (!due.length) return { stops: [], totalMeters: 0, start: depot || null };
    const start = isLatLng(depot) ? { lat: Number(depot.lat), lng: Number(depot.lng) } : { lat: Number(due[0].lat), lng: Number(due[0].lng) };
    const { order, legs, totalMeters } = optimizeRoute(start, due);
    return {
        start,
        totalMeters,
        stops: order.map((idx, i) => ({
            seq: i + 1,
            id: due[idx].id,
            name: due[idx].name,
            lat: Number(due[idx].lat),
            lng: Number(due[idx].lng),
            fill: due[idx].fill.level,
            status: due[idx].status,
            legMeters: legs[i],
        })),
    };
}

module.exports = { binFill, summarizeFleet, planCollectionRoute };
