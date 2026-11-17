const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceMeters, checkGeofence, optimizeRoute } = require('../lib/geo');

const BIN = { lat: 12.9637, lng: 77.5058 };
// ~1 m of latitude = 1/111_320 degrees.
const north = (m) => ({ lat: BIN.lat + m / 111320, lng: BIN.lng });

test('distanceMeters is accurate at campus scale', () => {
    assert.ok(Math.abs(distanceMeters(BIN, north(100)) - 100) < 0.5);
    assert.equal(distanceMeters(BIN, BIN), 0);
});

test('geofence: standing at the bin passes; ~50 m plus GPS tolerance passes', () => {
    assert.deepEqual(checkGeofence({ ...north(10), accuracy: 15 }, BIN), { ok: true, distance: 10 });
    assert.equal(checkGeofence({ ...north(60), accuracy: 20 }, BIN).ok, true, '50 + min(20, 25) = 70 m allowed');
    assert.equal(checkGeofence({ ...north(60), accuracy: 5 }, BIN).ok, false, 'precise fix: only 55 m allowed');
});

test('geofence: far away is refused with the distance', () => {
    const r = checkGeofence({ ...north(800), accuracy: 10 }, BIN);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_far');
    assert.ok(Math.abs(r.distance - 800) <= 1);
});

test('geofence: tolerance is capped, so a vague fix cannot stretch the fence', () => {
    assert.equal(checkGeofence({ ...north(90), accuracy: 99 }, BIN).ok, false, 'max allowed is 75 m');
    assert.deepEqual(checkGeofence({ ...north(5), accuracy: 150 }, BIN), { ok: false, reason: 'inaccurate', accuracy: 150 });
});

test('geofence: missing or malformed locations are refused; bins without coordinates are skipped', () => {
    for (const loc of [undefined, null, {}, { lat: 'x', lng: 1, accuracy: 5 }, { lat: 12, lng: 77 }, { lat: 200, lng: 77, accuracy: 5 }, { ...BIN, accuracy: -1 }]) {
        assert.deepEqual(checkGeofence(loc, BIN), { ok: false, reason: 'missing' }, JSON.stringify(loc));
    }
    assert.equal(checkGeofence(undefined, { lat: null, lng: null }).ok, true);
});

test('optimizeRoute visits every stop once and beats the given order on a zig-zag', () => {
    const start = { lat: 0, lng: 0 };
    const stops = [0.004, 0.001, 0.003, 0.002].map(lng => ({ lat: 0, lng }));
    const r = optimizeRoute(start, stops);
    assert.deepEqual(r.order, [1, 3, 2, 0]);
    assert.equal(r.legs.length, 4);
    assert.ok(Math.abs(r.totalMeters - distanceMeters(start, { lat: 0, lng: 0.004 })) < 2);
});

test('optimizeRoute 2-opt removes crossings', () => {
    // A square visited from a corner: the optimal open path walks the perimeter.
    const start = { lat: 0, lng: 0 };
    const stops = [{ lat: 0.001, lng: 0.001 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0 }];
    const r = optimizeRoute(start, stops);
    const side = distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    assert.ok(r.totalMeters <= Math.round(3 * side) + 2, `${r.totalMeters} vs ${3 * side}`);
});

test('optimizeRoute skips stops without coordinates and handles empty input', () => {
    assert.deepEqual(optimizeRoute({ lat: 0, lng: 0 }, []), { order: [], legs: [], totalMeters: 0 });
    const r = optimizeRoute({ lat: 0, lng: 0 }, [{ lat: null, lng: null }, { lat: 0, lng: 0.001 }]);
    assert.deepEqual(r.order, [1]);
});
