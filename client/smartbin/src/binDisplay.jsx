import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Maximize, WifiOff, KeyRound, Loader2 } from 'lucide-react';
import api from './api';
import { tk, useI18n } from './i18n';
import { Logo, BRAND_NAME } from './brand';
import { streamOf } from './waste';
import kn from './locales/kn.json';
import hi from './locales/hi.json';

// The screen on a smart bin (a cheap tablet / kiosk browser). It shows a QR code that changes every
// period (30 s). Anyone scanning it must be standing at the bin: a photo or screenshot of the code
// stops working within a minute.
//
// Opened from the operations console ("Bin screen setup") as:
//   /bin-display#bin=<binId>&v=<keyVersion>&key=<deviceKey>
// The device key stays in the URL fragment, which browsers never send to any server.
//
// Code = NAAVBIN:v2:<binId>:<v>:<counter>:<sig>, sig = base64url(HMAC-SHA256(deviceKey, "v2:<binId>:<v>:<counter>"))[0..22]
// — computed locally, so the screen keeps working offline. When online, it syncs its clock with the API.

const RESYNC_MS = 5 * 60 * 1000;

function parseFragment() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const bin = p.get('bin') || '';
  const v = Number(p.get('v') || 1);
  const key = p.get('key') || '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(bin) && key && Number.isInteger(v) && v > 0 ? { bin, v, key } : null;
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signCounter(cryptoKey, binId, version, counter) {
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`v2:${binId}:${version}:${counter}`));
  return `NAAVBIN:v2:${binId}:${version}:${counter}:${base64url(new Uint8Array(mac)).slice(0, 22)}`;
}

const LINES = {
  scan: tk('Scan this code with the Naav Bins app'),
  changes: tk('The code changes every few seconds — scan it here, at the bin.'),
};
const tri = (key) => [key, kn[key], hi[key]].filter(Boolean);

export default function BinDisplay() {
  const { t } = useI18n();
  const config = useMemo(parseFragment, []);
  const canvasRef = useRef(null);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [info, setInfo] = useState({ name: null, stream: 'station', period: 30, offset: 0, online: null, keyVersion: null });
  const [code, setCode] = useState(null);
  const [remaining, setRemaining] = useState(1);

  useEffect(() => {
    if (!config) return;
    crypto.subtle.importKey('raw', new TextEncoder().encode(config.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(setCryptoKey)
      .catch(() => setCryptoKey(null));
  }, [config]);

  // Clock sync + key check with the API (optional: the screen works offline with its own clock).
  const hello = useCallback(async () => {
    if (!config) return;
    const sent = Date.now();
    try {
      const res = await api.get('/api/device/hello', { headers: { 'X-Bin-Id': config.bin, 'X-Device-Key': config.key }, timeout: 15000 });
      const received = Date.now();
      const d = res.data;
      setInfo({
        name: d.bin.name,
        stream: d.bin.stream,
        period: d.period || 30,
        offset: d.serverTime - (sent + received) / 2,
        online: true,
        keyVersion: d.keyVersion,
      });
    } catch (err) {
      setInfo((i) => ({ ...i, online: err?.response?.status === 401 ? 'revoked' : false }));
    }
  }, [config]);

  useEffect(() => {
    hello();
    const id = setInterval(hello, RESYNC_MS);
    return () => clearInterval(id);
  }, [hello]);

  // Keep the screen awake while the page is open.
  useEffect(() => {
    let lock = null;
    const request = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release?.(); };
  }, []);

  // Tick: new code each period, countdown every 250 ms.
  useEffect(() => {
    if (!config || !cryptoKey) return undefined;
    let last = null;
    let active = true;
    const tick = async () => {
      const now = Date.now() + info.offset;
      const periodMs = info.period * 1000;
      const counter = Math.floor(now / periodMs);
      setRemaining(1 - (now % periodMs) / periodMs);
      if (counter === last) return;
      last = counter;
      const payload = await signCounter(cryptoKey, config.bin, config.v, counter);
      if (active) setCode(payload);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => { active = false; clearInterval(id); };
  }, [config, cryptoKey, info.offset, info.period]);

  useEffect(() => {
    if (code && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, code, { errorCorrectionLevel: 'M', margin: 2, width: 420, color: { dark: '#0b1f17', light: '#ffffff' } })
        .catch(() => {});
    }
  }, [code]);

  const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  if (!config) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <KeyRound className="mx-auto text-gray-400 mb-3" size={40} aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900">{t('This screen is not set up yet')}</h1>
          <p className="text-gray-600 text-sm mt-2">{t('Open the operations console, choose the bin, and use "Bin screen setup" to open this page with the bin\'s key.')}</p>
        </div>
      </div>
    );
  }

  const revoked = info.online === 'revoked' || (info.keyVersion && info.keyVersion !== config.v);
  const stream = streamOf(info.stream);

  return (
    <div className="min-h-dvh bg-[#0b1f17] text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="absolute top-4 left-4"><Logo size={36} tone="light" /></div>
      <button onClick={fullscreen} aria-label={t('Full screen')} className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10"><Maximize size={22} /></button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-center mb-1">{info.name || t('Bin {id}', { id: config.bin })}</h1>
      <p className="font-bold mb-6 text-emerald-200 flex items-center gap-2">
        <span className="w-3 h-3 rounded-full ring-2 ring-white/60" style={{ background: stream.color }} aria-hidden="true" />
        {t(stream.label)} · {t(stream.bin)}
      </p>

      {revoked ? (
        <div role="alert" className="bg-red-500/15 border border-red-400/40 rounded-2xl p-8 max-w-md text-center">
          <KeyRound className="mx-auto mb-3 text-red-300" size={40} aria-hidden="true" />
          <p className="font-bold text-red-200">{t('This screen\'s key was replaced. Ask an admin to set it up again.')}</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-3xl p-3 shadow-2xl relative">
            {code ? <canvas ref={canvasRef} aria-label={t('Live QR code for this bin')} className="block w-[min(80vw,420px)] h-auto" />
              : <div className="w-[min(80vw,420px)] aspect-square flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" size={48} /></div>}
          </div>
          <div className="w-[min(80vw,420px)] h-2 bg-white/10 rounded-full mt-4 overflow-hidden" aria-hidden="true">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round(remaining * 100)}%`, transition: 'width 250ms linear' }} />
          </div>
        </>
      )}

      <div className="mt-8 text-center space-y-1">
        {tri(LINES.scan).map((line, i) => <p key={i} className={i ? 'text-lg text-emerald-100' : 'text-xl font-bold'}>{line.replace('Naav Bins', BRAND_NAME)}</p>)}
        <div className="pt-2 space-y-0.5">
          {tri(LINES.changes).map((line, i) => <p key={i} className="text-sm text-emerald-200/80">{line}</p>)}
        </div>
      </div>

      {info.online === false && (
        <p className="mt-6 text-xs text-amber-300 flex items-center gap-1"><WifiOff size={14} aria-hidden="true" /> {t('Offline — codes still work; clock sync resumes when back online.')}</p>
      )}
    </div>
  );
}
