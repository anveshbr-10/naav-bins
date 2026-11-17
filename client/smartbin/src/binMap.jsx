import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { Loader2, LocateFixed, Navigation, RefreshCw, ChevronDown, ChevronUp, MapPinOff, WifiOff } from 'lucide-react';
import api from './api';
import AppShell from './layout';

// Only used until bins load; afterwards the map fits to wherever the bins actually are.
const FALLBACK_CENTER = [12.9637, 77.5058];
// Zoom out to include the user only when they are reasonably close to the bins.
const NEARBY_FIT_LIMIT_M = 3000;
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 };

const STATUS = {
    Active:   { color: '#10b981', label: 'Active', order: 0 },
    Full:     { color: '#ef4444', label: 'Full', order: 1 },
    Inactive: { color: '#9ca3af', label: 'Inactive', order: 2 },
};
const statusInfo = (s) => STATUS[s] || { color: '#9ca3af', label: String(s || 'Unknown'), order: 3 };

function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function directionsUrl(bin) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(bin.lat)},${Number(bin.lng)}&travelmode=walking`;
}

// DOM helper: text always goes through textContent so database values are never parsed as HTML.
function el(tag, css, text) {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text !== undefined) node.textContent = String(text ?? '');
    return node;
}

export default function BinMap() {
    const navigate = useNavigate();

    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const binLayerRef = useRef(null);
    const userLayerRef = useRef(null);
    const markersRef = useRef(new Map());
    const userPosRef = useRef(null);
    const fittedRef = useRef(false);
    const userFittedRef = useRef(false);
    const recenterRef = useRef(false);

    const [bins, setBins] = useState([]);
    const [loadState, setLoadState] = useState('loading'); // loading | ready | error
    const [refreshing, setRefreshing] = useState(false);
    const [userPos, setUserPos] = useState(null);
    const [geoState, setGeoState] = useState(() => ('geolocation' in navigator ? 'locating' : 'unavailable'));
    const [panelOpen, setPanelOpen] = useState(true);

    // ---------- Data ----------
    const loadBins = useCallback(() => api.get('/api/bins')
        .then((res) => {
            const list = Array.isArray(res.data.bins) ? res.data.bins : [];
            setBins(list.filter(b => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng)))
                .map(b => ({ ...b, lat: Number(b.lat), lng: Number(b.lng) })));
            setLoadState('ready');
        })
        .catch(() => setLoadState('error')), []);

    useEffect(() => { loadBins(); }, [loadBins]);

    const refresh = () => {
        setRefreshing(true);
        if (!bins.length) setLoadState('loading');
        loadBins().finally(() => setRefreshing(false));
    };

    const onPosition = useCallback((pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        userPosRef.current = next;
        setUserPos(next);
        setGeoState('ok');
    }, []);

    const onPositionError = useCallback((err) => {
        setGeoState(err && err.code === 1 ? 'denied' : 'unavailable');
    }, []);

    useEffect(() => {
        if (!('geolocation' in navigator)) return;
        navigator.geolocation.getCurrentPosition(onPosition, onPositionError, GEO_OPTIONS);
    }, [onPosition, onPositionError]);

    const locate = () => {
        if (!('geolocation' in navigator)) { setGeoState('unavailable'); return; }
        recenterRef.current = true;
        setGeoState('locating');
        navigator.geolocation.getCurrentPosition(onPosition, onPositionError, GEO_OPTIONS);
    };

    // ---------- Actions ----------
    const goScan = useCallback((bin) => {
        if (bin.status !== 'Active') return;
        localStorage.setItem('current_bin_location', bin.name);
        navigate('/scan');
    }, [navigate]);

    const buildPopup = useCallback((bin) => {
        const info = statusInfo(bin.status);
        const isActive = bin.status === 'Active';
        const root = el('div', 'text-align:center;font-family:sans-serif;min-width:180px');
        root.append(
            el('h3', 'margin:0 0 6px;font-weight:bold;font-size:16px', bin.name),
            el('span', `background:${info.color};color:#fff;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:bold`, info.label),
        );
        if (userPosRef.current) {
            root.append(el('div', 'margin-top:6px;font-size:12px;color:#475569', `${formatDistance(distanceMeters(userPosRef.current, bin))} away`));
        }

        const actions = el('div', 'margin-top:10px;display:flex;gap:6px;justify-content:center');
        const scan = el('button', `border:none;padding:6px 12px;border-radius:6px;font-weight:bold;color:#fff;${isActive
            ? 'background:#059669;cursor:pointer' : 'background:#9ca3af;cursor:not-allowed;opacity:.8'}`, 'Scan Here');
        scan.type = 'button';
        scan.disabled = !isActive;
        scan.addEventListener('click', () => goScan(bin));

        const dir = el('a', 'padding:6px 12px;border-radius:6px;font-weight:bold;background:#e2e8f0;color:#0f172a;text-decoration:none', 'Directions');
        dir.href = directionsUrl(bin);
        dir.target = '_blank';
        dir.rel = 'noopener noreferrer';

        actions.append(scan, dir);
        root.append(actions);
        if (!isActive) root.append(el('div', 'margin-top:6px;font-size:11px;color:#64748b', 'This bin is not accepting items right now.'));
        return root;
    }, [goScan]);

    const focusBin = (bin) => {
        const map = mapRef.current;
        const marker = markersRef.current.get(bin.id);
        if (!map || !marker) return;
        map.once('moveend', () => marker.openPopup());
        map.flyTo([bin.lat, bin.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
    };

    // ---------- Map setup (once) ----------
    useEffect(() => {
        const map = L.map(mapContainerRef.current, { zoomControl: false }).setView(FALLBACK_CENTER, 17);
        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri', maxZoom: 19,
        });
        const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
        });
        satellite.addTo(map);
        L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);
        L.control.zoom({ position: 'topright' }).addTo(map);

        binLayerRef.current = L.layerGroup().addTo(map);
        userLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        const markers = markersRef.current;

        return () => {
            map.remove();
            mapRef.current = null;
            markers.clear();
            fittedRef.current = false;
            userFittedRef.current = false;
        };
    }, []);

    // Leaflet must re-measure when the side/bottom panel changes size.
    useEffect(() => {
        const t = setTimeout(() => mapRef.current?.invalidateSize(), 250);
        return () => clearTimeout(t);
    }, [panelOpen]);

    // ---------- Bin markers ----------
    useEffect(() => {
        const map = mapRef.current;
        const layer = binLayerRef.current;
        if (!map || !layer) return;

        layer.clearLayers();
        markersRef.current.clear();
        for (const bin of bins) {
            const marker = L.circleMarker([bin.lat, bin.lng], {
                radius: 11, color: '#ffffff', weight: 3, fillColor: statusInfo(bin.status).color, fillOpacity: 1,
            }).bindPopup(() => buildPopup(bin));
            layer.addLayer(marker);
            markersRef.current.set(bin.id, marker);
        }

        if (!fittedRef.current && bins.length) {
            map.fitBounds(L.latLngBounds(bins.map(b => [b.lat, b.lng])).pad(0.25), { maxZoom: 18 });
            fittedRef.current = true;
        }
    }, [bins, buildPopup]);

    // ---------- User marker ----------
    useEffect(() => {
        const map = mapRef.current;
        const layer = userLayerRef.current;
        if (!map || !layer) return;
        layer.clearLayers();
        if (!userPos) return;

        const here = [userPos.lat, userPos.lng];
        if (userPos.accuracy) {
            L.circle(here, { radius: Math.min(userPos.accuracy, 300), color: '#3b82f6', weight: 1, fillOpacity: 0.1 }).addTo(layer);
        }
        L.circleMarker(here, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(layer);

        if (recenterRef.current) {
            recenterRef.current = false;
            map.flyTo(here, Math.max(map.getZoom(), 17), { duration: 0.6 });
            return;
        }
        if (!userFittedRef.current && bins.length) {
            const nearest = bins.reduce((best, b) => {
                const d = distanceMeters(userPos, b);
                return !best || d < best.d ? { b, d } : best;
            }, null);
            if (nearest && nearest.d <= NEARBY_FIT_LIMIT_M) {
                map.fitBounds(L.latLngBounds([here, [nearest.b.lat, nearest.b.lng]]).pad(0.4), { maxZoom: 18 });
            }
            userFittedRef.current = true;
        }
    }, [userPos, bins]);

    // ---------- Derived list ----------
    const sortedBins = useMemo(() => bins
        .map(b => ({ ...b, distance: userPos ? distanceMeters(userPos, b) : null }))
        .sort((a, b) => {
            if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
            return statusInfo(a.status).order - statusInfo(b.status).order || String(a.name).localeCompare(String(b.name));
        }), [bins, userPos]);

    const activeCount = bins.filter(b => b.status === 'Active').length;
    const nearestActiveId = userPos ? sortedBins.find(b => b.status === 'Active')?.id : undefined;

    const geoMessage = {
        locating: 'Finding your location…',
        ok: 'Sorted by distance from you',
        denied: 'Location is blocked. Allow it in your browser to sort bins by distance.',
        unavailable: 'Location unavailable. Bins are sorted by status.',
    }[geoState];

    return (
        <AppShell fullHeight>
        <div className="flex-1 min-h-0 w-full flex flex-col bg-slate-100">

            {/* HEADER */}
            <div className="flex items-center justify-between gap-3 bg-white px-4 py-3 border-b border-slate-200">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-slate-800 truncate">Bin map</h1>
                        <p className="text-xs text-slate-500 truncate" aria-live="polite">
                            {loadState === 'ready' || bins.length
                                ? `${bins.length} bins · ${activeCount} accepting items`
                                : 'Loading bins…'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={refresh}
                        disabled={refreshing}
                        aria-label="Refresh bin status"
                        className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={locate}
                        className="flex items-center gap-2 px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                    >
                        {geoState === 'locating' ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
                        <span className="hidden sm:inline">My location</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col-reverse md:flex-row">

                {/* NEARBY LIST */}
                <aside className={`bg-white md:w-80 md:h-full md:border-r border-t md:border-t-0 border-slate-200 flex flex-col ${panelOpen ? 'max-h-[42vh] md:max-h-none' : ''}`}>
                    <button
                        onClick={() => setPanelOpen(o => !o)}
                        className="flex items-center justify-between px-4 py-3 font-bold text-slate-700 md:pointer-events-none"
                        aria-expanded={panelOpen}
                    >
                        Nearby bins
                        <span className="md:hidden">{panelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span>
                    </button>

                    <div className={`${panelOpen ? 'flex' : 'hidden'} md:flex flex-col min-h-0 flex-1`}>
                        <p className="px-4 pb-2 text-xs text-slate-500">{geoMessage}</p>
                        <ul className="overflow-y-auto flex-1 min-h-0 border-t border-slate-100">
                            {sortedBins.map(bin => {
                                const info = statusInfo(bin.status);
                                return (
                                    <li key={bin.id} className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 hover:bg-slate-50">
                                        <button onClick={() => focusBin(bin)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: info.color }} />
                                            <span className="min-w-0">
                                                <span className="block font-semibold text-slate-800 truncate">{bin.name}</span>
                                                <span className="block text-xs text-slate-500">
                                                    {info.label}
                                                    {bin.distance !== null && ` · ${formatDistance(bin.distance)}`}
                                                    {bin.id === nearestActiveId && <span className="text-emerald-600 font-bold"> · Nearest</span>}
                                                </span>
                                            </span>
                                        </button>
                                        <a
                                            href={directionsUrl(bin)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`Directions to ${bin.name}`}
                                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                                        >
                                            <Navigation size={18} />
                                        </a>
                                        {bin.status === 'Active' && (
                                            <button
                                                onClick={() => goScan(bin)}
                                                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                                            >
                                                Scan
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                            {loadState === 'ready' && bins.length === 0 && (
                                <li className="px-4 py-6 text-center text-sm text-slate-400">No bins registered yet.</li>
                            )}
                        </ul>
                        <div className="flex items-center gap-4 px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
                            {['Active', 'Full', 'Inactive'].map(s => (
                                <span key={s} className="flex items-center gap-1">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS[s].color }} /> {s}
                                </span>
                            ))}
                            <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> You
                            </span>
                        </div>
                    </div>
                </aside>

                {/* MAP */}
                <div className="relative flex-1 min-h-0">
                    <div ref={mapContainerRef} className="absolute inset-0 z-0" role="region" aria-label="Map of smart bins" />

                    {loadState === 'loading' && !bins.length && (
                        <div role="status" className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-slate-900/70 backdrop-blur-sm text-white">
                            <Loader2 className="animate-spin w-12 h-12 text-emerald-400 mb-4" />
                            <p className="text-lg font-bold tracking-wide">Loading bins…</p>
                            <p className="text-xs text-slate-300 mt-1">The server may take up to 30 seconds to wake up.</p>
                        </div>
                    )}

                    {loadState === 'error' && !bins.length && (
                        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4">
                            <div className="bg-white rounded-2xl p-6 text-center max-w-sm shadow-xl">
                                <WifiOff className="mx-auto text-slate-400 mb-3" size={36} />
                                <p className="font-bold text-slate-800">Could not load bins</p>
                                <p className="text-sm text-slate-500 mt-1">Check your connection and try again.</p>
                                <button onClick={refresh} className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700">
                                    <RefreshCw size={16} /> Try again
                                </button>
                            </div>
                        </div>
                    )}

                    {loadState === 'error' && bins.length > 0 && (
                        <div className="absolute top-3 left-3 right-16 z-[1000] bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-2 shadow">
                            Couldn't refresh bin status. Showing the last known status.
                        </div>
                    )}

                    {loadState === 'ready' && bins.length === 0 && (
                        <div className="absolute inset-0 z-[1000] flex items-center justify-center p-4 pointer-events-none">
                            <div className="bg-white rounded-2xl p-6 text-center max-w-sm shadow-xl">
                                <MapPinOff className="mx-auto text-slate-400 mb-3" size={36} />
                                <p className="font-bold text-slate-800">No smart bins yet</p>
                                <p className="text-sm text-slate-500 mt-1">Bins will appear here once they are registered.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </AppShell>
    );
}
