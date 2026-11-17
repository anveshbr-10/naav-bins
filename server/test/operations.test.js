const test = require('node:test');
const assert = require('node:assert/strict');
const { binFill, summarizeFleet, planCollectionRoute } = require('../lib/operations');

const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

test('fill: fresh sensor reading wins, stale sensor falls back to the estimate', () => {
    const bin = { capacity_items: 100, fill_level: 64, fill_source: 'sensor', fill_updated_at: iso(NOW - HOUR) };
    assert.deepEqual(binFill(bin, 10, NOW), { level: 64, source: 'sensor', updatedAt: bin.fill_updated_at });
    const stale = { ...bin, fill_updated_at: iso(NOW - 7 * HOUR) };
    assert.deepEqual(binFill(stale, 10, NOW), { level: 10, source: 'estimate', updatedAt: null });
    assert.equal(binFill({ capacity_items: 50 }, 80, NOW).level, 100, 'capped at 100');
    assert.equal(binFill({ fill_level: 30, fill_source: 'manual', fill_updated_at: iso(NOW - 2 * HOUR) }, 0, NOW).source, 'manual');
});

const BINS = [
    { id: 'a', name: 'A', lat: 12.96, lng: 77.5, status: 'Active', stream: 'dry', capacity_items: 10, last_emptied_at: iso(NOW - 5 * HOUR) },
    { id: 'b', name: 'B', lat: 12.961, lng: 77.501, status: 'Full', stream: 'station', capacity_items: 10 },
    { id: 'c', name: 'C', lat: 12.962, lng: 77.5, status: 'Active', stream: 'wet', capacity_items: 10 },
];
const LOGS = [
    ...Array.from({ length: 8 }, (_, i) => ({ bin_id: 'a', user_id: `u${i % 3}`, accepted: true, created_at: iso(NOW - HOUR), est_weight_kg: 0.05 })),
    { bin_id: 'a', user_id: 'u1', accepted: true, created_at: iso(NOW - 10 * HOUR), est_weight_kg: 0.05 }, // before emptying
    { bin_id: 'a', user_id: 'u1', accepted: false, reject_reason: 'wrong_stream', created_at: iso(NOW - HOUR) },
    { bin_id: 'a', user_id: 'u2', accepted: false, reject_reason: 'wrong_stream', created_at: iso(NOW - HOUR) },
    { bin_id: 'c', user_id: 'u1', accepted: true, created_at: iso(NOW - HOUR), est_weight_kg: 0.1, measured_weight_kg: 0.3 },
];

test('fleet summary: fill since emptying, contamination rate, audited contamination, flags', () => {
    const { bins, totals } = summarizeFleet({
        bins: BINS,
        logs: LOGS,
        collections: [{ bin_id: 'a', contamination_pct: 12, collected_at: iso(NOW - 5 * HOUR) }],
        flags: [{ bin_id: 'a' }, { bin_id: 'a' }, { bin_id: null }],
        nowMs: NOW,
    });
    const a = bins.find(b => b.id === 'a');
    assert.equal(a.fill.level, 80, '8 items since emptying / capacity 10');
    assert.equal(a.items, 9);
    assert.equal(a.identifications, 11);
    assert.equal(a.wrongStream, 2);
    assert.equal(a.contaminationRate, 18.2);
    assert.deepEqual(a.auditedContamination, { pct: 12, at: iso(NOW - 5 * HOUR) });
    assert.equal(a.openFlags, 2);
    assert.equal(a.activeUsers, 3);
    const c = bins.find(b => b.id === 'c');
    assert.equal(c.measuredKg, 0.3);
    assert.equal(bins.find(b => b.id === 'b').contaminationRate, null);
    assert.equal(totals.bins, 3);
    assert.equal(totals.nearlyFull, 2, 'a by estimate, b because it is marked Full');
    assert.equal(totals.contaminationRate, 16.7);
});

test('a bin marked Full reports 100% fill even when the estimate is lower', () => {
    const { bins } = summarizeFleet({ bins: BINS, logs: LOGS, collections: [], flags: [], nowMs: NOW });
    const full = bins.filter(b => b.status === 'Full');
    assert.ok(full.length > 0);
    for (const b of full) assert.equal(b.fill.level, 100);
});

test('collection route: only bins over the threshold or marked Full, in optimised order from the depot', () => {
    const { bins } = summarizeFleet({ bins: BINS, logs: LOGS, collections: [], flags: [], nowMs: NOW });
    const route = planCollectionRoute(bins, { threshold: 70, depot: { lat: 12.9595, lng: 77.5 } });
    assert.deepEqual(route.stops.map(s => s.id), ['a', 'b']);
    assert.ok(route.stops.every((s, i) => s.seq === i + 1 && Number.isFinite(s.legMeters)));
    assert.ok(route.totalMeters > 0);
    assert.deepEqual(planCollectionRoute(bins, { threshold: 100, depot: null }).stops.map(s => s.id), ['b']);
    assert.deepEqual(planCollectionRoute([], { threshold: 70 }).stops, []);
});

test('fill: a manual reading holds until emptied, and deposits since can only raise it', () => {
    const bin = { capacity_items: 100, fill_level: 60, fill_source: 'manual', fill_updated_at: iso(NOW - 72 * HOUR) };
    assert.deepEqual(binFill(bin, 10, NOW), { level: 60, source: 'manual', updatedAt: bin.fill_updated_at });
    assert.equal(binFill(bin, 85, NOW).level, 85);
});
