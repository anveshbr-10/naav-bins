// Geofence checks and collection-route optimisation. Pure functions: no I/O.

const EARTH_RADIUS_M = 6371000;

function toRad(d) { return (d * Math.PI) / 180; }

const coord = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));

function isLatLng(p) {
    return Boolean(p) && Number.isFinite(coord(p.lat)) && Number.isFinite(coord(p.lng))
        && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180;
}

// Great-circle distance in metres.
function distanceMeters(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Is the user standing at the bin?
// The phone reports an accuracy radius. Readings worse than maxAccuracyM are refused (ask the user to
// step outside / wait for GPS). Otherwise the user passes when they are within radiusM of the bin,
// plus a tolerance of half the radius for GPS error (so ~75 m at most with the default 50 m).
// Returns { ok: true, distance } or { ok: false, reason: 'missing'|'inaccurate'|'too_far', distance? }.
function checkGeofence(user, bin, { radiusM = 50, maxAccuracyM = 100 } = {}) {
    if (!isLatLng(bin)) return { ok: true, distance: null, skipped: true }; // bin has no coordinates
    if (!isLatLng(user)) return { ok: false, reason: 'missing' };
    const accuracy = Number(user.accuracy);
    if (!Number.isFinite(accuracy) || accuracy < 0) return { ok: false, reason: 'missing' };
    if (accuracy > maxAccuracyM) return { ok: false, reason: 'inaccurate', accuracy };

    const here = { lat: Number(user.lat), lng: Number(user.lng) };
    const target = { lat: Number(bin.lat), lng: Number(bin.lng) };
    const distance = distanceMeters(here, target);
    const allowed = radiusM + Math.min(accuracy, radiusM / 2);
    if (distance > allowed) return { ok: false, reason: 'too_far', distance: Math.round(distance) };
    return { ok: true, distance: Math.round(distance) };
}

function pathLength(points, order) {
    let total = 0;
    for (let i = 1; i < order.length; i++) total += distanceMeters(points[order[i - 1]], points[order[i]]);
    return total;
}

// Shortest-ish open route that starts at `start` and visits every stop once (travelling-salesman
// heuristic: nearest neighbour, then 2-opt improvement). Good and fast for a campus fleet (< 200 stops).
// Returns { order: [stop indexes], legs: [metres to each stop], totalMeters }.
function optimizeRoute(start, stops) {
    const valid = stops.map((s, i) => ({ s, i })).filter(({ s }) => isLatLng(s));
    if (!valid.length) return { order: [], legs: [], totalMeters: 0 };

    const points = [start, ...valid.map(({ s }) => ({ lat: Number(s.lat), lng: Number(s.lng) }))];
    const n = points.length;

    // Nearest neighbour from the start (index 0).
    const visited = new Array(n).fill(false);
    visited[0] = true;
    const order = [0];
    for (let step = 1; step < n; step++) {
        const last = points[order[order.length - 1]];
        let best = -1, bestD = Infinity;
        for (let j = 1; j < n; j++) {
            if (visited[j]) continue;
            const d = distanceMeters(last, points[j]);
            if (d < bestD) { bestD = d; best = j; }
        }
        visited[best] = true;
        order.push(best);
    }

    // 2-opt on the open path; the start stays fixed in position 0.
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 200) {
        improved = false;
        for (let i = 1; i < n - 1; i++) {
            for (let k = i + 1; k < n; k++) {
                const a = points[order[i - 1]], b = points[order[i]];
                const c = points[order[k]], d = k + 1 < n ? points[order[k + 1]] : null;
                const before = distanceMeters(a, b) + (d ? distanceMeters(c, d) : 0);
                const after = distanceMeters(a, c) + (d ? distanceMeters(b, d) : 0);
                if (after + 1e-6 < before) {
                    const reversed = order.slice(i, k + 1).reverse();
                    order.splice(i, k - i + 1, ...reversed);
                    improved = true;
                }
            }
        }
    }

    const legs = [];
    for (let i = 1; i < order.length; i++) legs.push(Math.round(distanceMeters(points[order[i - 1]], points[order[i]])));
    return {
        order: order.slice(1).map(j => valid[j - 1].i),
        legs,
        totalMeters: Math.round(pathLength(points, order)),
    };
}

module.exports = { distanceMeters, checkGeofence, optimizeRoute, isLatLng };
