import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Route as RouteIcon, Loader2, ExternalLink, Truck } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk, translate } from '../i18n';
import { streamOf } from '../waste';
import { useAuthErrorHandler } from './useAdminApi';
import { Panel, buttonPrimary, inputClass } from './ui';
import { fillBandColor } from './fill';

const LAYERS = [
  { id: 'fill', label: tk('Fill level'), value: (b) => b.fill.level, max: 100 },
  { id: 'activity', label: tk('Activity'), value: (b) => b.items, max: null },
  { id: 'contamination', label: tk('Contamination'), value: (b) => b.contaminationRate ?? 0, max: 50 },
];

// Green → amber → red.
function heatColor(x) {
  const v = Math.max(0, Math.min(1, x));
  const hue = 130 - 130 * v;
  return `hsl(${hue} 85% 45%)`;
}

const fmtKm = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} km`);

function el(tag, css, text) {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text !== undefined) node.textContent = String(text ?? '');
  return node;
}

// Google Maps directions through every stop (opens on the collector's phone).
function mapsUrl(start, stops) {
  if (!stops.length) return null;
  const pt = (p) => `${p.lat},${p.lng}`;
  const dest = stops[stops.length - 1];
  const via = stops.slice(0, -1).slice(0, 9).map(pt).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${pt(start)}&destination=${pt(dest)}${via ? `&waypoints=${encodeURIComponent(via)}` : ''}&travelmode=driving`;
}

export default function OpsMap({ bins, depot }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const heatLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const fittedRef = useRef(false);
  const [layer, setLayer] = useState('fill');
  const [threshold, setThreshold] = useState(70);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState(null);

  const placed = useMemo(() => bins.filter((b) => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng)) && b.lat !== null), [bins]);

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: false }).setView([12.9637, 77.5058], 17);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 19 });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 });
    streets.addTo(map);
    L.control.layers({ Streets: streets, Satellite: satellite }, null, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    heatLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; fittedRef.current = false; };
  }, []);

  // Heat layer: stacked translucent circles give each bin a glow whose size and colour follow the metric.
  useEffect(() => {
    const map = mapRef.current;
    const group = heatLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const def = LAYERS.find((l) => l.id === layer);
    const max = def.max ?? Math.max(1, ...placed.map(def.value));
    for (const b of placed) {
      const inactive = b.status === 'Inactive';
      const v = inactive ? 0 : def.value(b) / max;
      const color = inactive ? '#9ca3af' : layer === 'fill' ? fillBandColor(b.fill.level) : heatColor(v);
      const base = 18 + 50 * v;
      for (const [k, opacity] of [[1, 0.12], [0.66, 0.16], [0.33, 0.22]]) {
        L.circle([b.lat, b.lng], { radius: base * k, stroke: false, fillColor: color, fillOpacity: opacity, interactive: false }).addTo(group);
      }
      const stream = streamOf(b.stream);
      const marker = L.circleMarker([b.lat, b.lng], { radius: 8, color: stream.color, weight: 3, fillColor: color, fillOpacity: 1 });
      const popup = el('div', 'min-width:180px;font-family:inherit');
      popup.append(
        el('strong', 'display:block;font-size:14px;margin-bottom:4px', b.name),
        el('div', 'font-size:12px', `${translate(stream.label)} · ${translate(b.status === 'Active' ? tk('Active') : b.status === 'Full' ? tk('Full') : tk('Inactive'))}`),
        inactive ? el('div', 'font-size:12px;color:#6b7280', translate(tk('Fill: inactive'))) : el('div', 'font-size:12px', translate(tk('Fill: {n}% ({source})'), { n: b.fill.level, source: translate(b.fill.source === 'sensor' ? tk('sensor') : b.fill.source === 'manual' ? tk('manual') : tk('estimate')) })),
        el('div', 'font-size:12px', translate(tk('{n} items · {kg} kg this period'), { n: b.items, kg: b.weightKg })),
        el('div', 'font-size:12px', translate(tk('Contamination: {rate}'), { rate: b.contaminationRate === null ? '—' : `${b.contaminationRate}%` })),
      );
      if (b.openFlags) popup.append(el('div', 'font-size:12px;color:#dc2626;font-weight:bold', translate(tk('{n} open fraud flags'), { n: b.openFlags })));
      marker.bindPopup(popup).addTo(group);
    }
    if (!fittedRef.current && placed.length) {
      map.fitBounds(L.latLngBounds(placed.map((b) => [b.lat, b.lng])).pad(0.25), { maxZoom: 18 });
      fittedRef.current = true;
    }
  }, [placed, layer, t]);

  // Route overlay.
  useEffect(() => {
    const group = routeLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (!route || !route.stops.length) return;
    const path = [[route.start.lat, route.start.lng], ...route.stops.map((s) => [s.lat, s.lng])];
    L.polyline(path, { color: '#4f46e5', weight: 5, opacity: 0.85, dashArray: '10 8' }).addTo(group);
    L.circleMarker(path[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 1 })
      .bindTooltip(translate(tk('Start')), { permanent: true, direction: 'top', offset: [0, -8] }).addTo(group);
    route.stops.forEach((s) => {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#4f46e5;color:#fff;border:2px solid #fff;border-radius:999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3)">${Number(s.seq)}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      }).addTo(group);
    });
    mapRef.current?.fitBounds(L.latLngBounds(path).pad(0.2), { maxZoom: 18 });
  }, [route]);

  const planRoute = async () => {
    setRouting(true);
    setRouteError(null);
    try {
      const params = { threshold };
      // No depot configured: start where the collector is (if the browser shares it), else the server
      // starts at the first bin that is due.
      if (!depot && 'geolocation' in navigator) {
        const here = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 5000, maximumAge: 60000 }));
        if (here) Object.assign(params, here);
      }
      const res = await api.get('/api/admin/ops/route', { params });
      setRoute(res.data);
    } catch (err) {
      if (!handleAuthError(err)) setRouteError(apiErrorMessage(err, tk('Could not plan the route.')));
    } finally {
      setRouting(false);
    }
  };

  const def = LAYERS.find((l) => l.id === layer);
  const url = route && route.stops.length ? mapsUrl(route.start, route.stops) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Panel
        className="xl:col-span-2"
        title={t('Fleet map')}
        subtitle={t('Glow size and colour show the selected metric. Marker ring = waste stream.')}
        actions={
          <div role="group" aria-label={t('Heat layer')} className="inline-flex rounded-lg bg-slate-100 p-1">
            {LAYERS.map((l) => (
              <button key={l.id} onClick={() => setLayer(l.id)} aria-pressed={layer === l.id}
                className={`px-3 py-1.5 rounded-md text-xs font-bold ${layer === l.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}>
                {t(l.label)}
              </button>
            ))}
          </div>
        }
      >
        <div className="relative h-[420px]">
          <div ref={containerRef} className="absolute inset-0 z-0" role="region" aria-label={t('Fleet map')} />
          <div className="absolute bottom-3 left-3 z-[500] bg-white/95 rounded-lg shadow px-3 py-2 text-xs text-slate-600">
            <p className="font-bold text-slate-700 mb-1">{t(def.label)}</p>
            <div className="flex items-center gap-2">
              <span>{t('Low')}</span>
              <span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
              <span>{t('High')}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title={t('Collection route')} subtitle={t('Bins at or above the fill threshold (or marked Full), in the shortest visiting order.')}>
        <div className="p-4 sm:p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t('Fill threshold: {n}%', { n: threshold })}</span>
            <input type="range" min={10} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className={`${inputClass} p-0 accent-indigo-600`} />
          </label>
          <button onClick={planRoute} disabled={routing} className={`${buttonPrimary} w-full`}>
            {routing ? <Loader2 size={16} className="animate-spin" /> : <RouteIcon size={16} aria-hidden="true" />} {t('Plan collection route')}
          </button>
          {!depot && <p className="text-xs text-slate-500">{t('Tip: set DEPOT_LAT / DEPOT_LNG on the server to start routes at the waste yard.')}</p>}
          {routeError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{routeError}</p>}
          {route && (
            route.stops.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3">{t('No bins need collecting at this threshold.')}</p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-slate-800 flex items-center gap-2"><Truck size={16} aria-hidden="true" /> {t('{n} stops', { n: route.stops.length })}</span>
                  <span className="text-slate-500">{t('Total {d}', { d: fmtKm(route.totalMeters) })}</span>
                </div>
                <ol className="divide-y divide-slate-100 border border-slate-100 rounded-xl max-h-64 overflow-y-auto">
                  {route.stops.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.seq}</span>
                      <span className="flex-1 min-w-0 truncate font-semibold text-slate-800">{s.name}</span>
                      <span className="text-xs text-slate-500 flex-shrink-0">{s.fill}% · +{fmtKm(s.legMeters)}</span>
                    </li>
                  ))}
                </ol>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-indigo-700 hover:underline">
                    {t('Open in Google Maps')} <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </>
            )
          )}
        </div>
      </Panel>
    </div>
  );
}
