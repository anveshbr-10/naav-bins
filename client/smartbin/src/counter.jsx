import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import { Store, Search, Loader2, CheckCircle2, XCircle, MapPin, ScanQrCode, IndianRupee, Camera } from 'lucide-react';
import AppShell from './layout';
import api, { apiErrorMessage, apiStatus } from './api';
import { useAuth } from './authContext';
import { useI18n, tk, localized } from './i18n';
import { formatDateTime } from './format';

const PAY_STATUS_LABEL = {
  Pending: tk('Waiting'), Completed: tk('Paid'), Expired: tk('Expired'), Cancelled: tk('Cancelled'), Refunded: tk('Refunded'),
};

// Normalises typed or scanned input: "NAAVPAY:NP-…" (student's payment QR) or "NP-…".
function cleanCode(raw) {
  let c = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (c.startsWith('NAAVPAY:')) c = c.slice(8);
  return c;
}

// Camera sessions must not overlap (React StrictMode mounts twice in development, and staff may
// open/close quickly): each start waits for the previous stop to finish.
let cameraChain = Promise.resolve();
const cameraSupported = () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

// Camera QR scanner for the student's payment code, with a photo fallback (works on any phone,
// even where the live camera is blocked, e.g. a non-HTTPS address).
function QrScan({ onCode, onClose }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(cameraSupported() ? 'starting' : 'unsupported'); // starting | live | unsupported | failed
  const [photoError, setPhotoError] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    if (!cameraSupported()) return undefined;
    let cancelled = false;
    let handled = false;
    const scanner = new Html5Qrcode('counter-qr', { verbose: false });
    const stop = () => (scanner.isScanning ? scanner.stop() : Promise.resolve())
      .catch(() => {})
      .then(() => { try { scanner.clear(); } catch { /* already cleared */ } });

    const run = cameraChain.then(async () => {
      if (cancelled) return;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => { const size = Math.max(150, Math.floor(Math.min(w, h) * 0.7)); return { width: size, height: size }; } },
          (text) => {
            if (handled || cancelled) return;
            handled = true;
            stop().then(() => onCodeRef.current(text));
          },
          () => { /* no QR in this frame */ },
        );
        if (!cancelled) setStatus('live');
      } catch (err) {
        console.error('Counter camera failed', err);
        if (!cancelled) setStatus('failed');
      }
    });
    return () => { cancelled = true; cameraChain = run.then(stop); };
  }, []);

  // Read the QR from a photo taken with the phone's camera app.
  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    const reader = new Html5Qrcode('counter-qr-file', { verbose: false });
    try {
      const text = await reader.scanFile(file, false);
      onCodeRef.current(text);
    } catch {
      setPhotoError(tk('No QR code found in that photo. Hold the phone closer and try again.'));
    } finally {
      try { reader.clear(); } catch { /* nothing to clear */ }
      setPhotoBusy(false);
    }
  };

  const camMessage = status === 'unsupported'
    ? tk('The live camera needs a secure (https) connection. Take a photo of the QR instead, or type the code.')
    : status === 'failed'
      ? tk('Camera could not start. Allow camera access in the browser, or take a photo of the QR instead.')
      : null;

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {status !== 'unsupported' && (
        <div className="relative bg-black min-h-[240px]">
          <div id="counter-qr" className="w-full" />
          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-sm">
              <Loader2 className="animate-spin" aria-hidden="true" /> {t('Starting camera…')}
            </div>
          )}
        </div>
      )}
      <div id="counter-qr-file" className="hidden" />
      <div className="p-3 space-y-2">
        {status === 'live' && <p className="text-sm text-gray-600 text-center">{t('Point the camera at the student\'s payment QR.')}</p>}
        {camMessage && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{t(camMessage)}</p>}
        {photoError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{t(photoError)}</p>}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
            className="py-2.5 rounded-xl text-sm font-bold border border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-60 flex items-center justify-center gap-2">
            {photoBusy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} aria-hidden="true" />} {t('Scan from photo')}
          </button>
          <button type="button" onClick={onClose} className="py-2.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">{t('Close camera')}</button>
        </div>
      </div>
    </div>
  );
}

// Canteen / snack stall / stationery / print-centre counter.
//   NP- codes: campus-wallet payments of an exact amount. Confirming deducts exactly that.
// Staff belong to one counter and only see codes for it; each code works once; daily limits apply
// (all enforced by the API and the database).
export default function Counter() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  const [payment, setPayment] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState('idle'); // idle | looking | claiming | claimed
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null); // { vendor, payments, paymentsInr }
  const [meError, setMeError] = useState(null);

  const handleAuth = useCallback((err) => {
    const status = apiStatus(err);
    if (status === 401) { signOut().then(() => navigate('/login')); return true; }
    return false;
  }, [navigate, signOut]);

  const loadMe = useCallback(() => {
    api.get('/api/counter/me')
      .then((res) => { setMe(res.data); setMeError(null); })
      .catch((err) => { if (!handleAuth(err)) setMeError(apiErrorMessage(err, tk('Could not load this counter.'))); });
  }, [handleAuth]);

  useEffect(() => { loadMe(); }, [loadMe]);

  const normalized = cleanCode(code);

  const lookupCode = useCallback(async (value) => {
    const c = cleanCode(value);
    setError(null);
    setPayment(null);
    setState('looking');
    try {
      const res = await api.get(`/api/counter/payment/${encodeURIComponent(c)}`);
      setPayment(res.data.payment);
      setState('idle');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(apiErrorMessage(err, tk('Could not look up this code.')));
      setState('idle');
    }
  }, [handleAuth]);

  const lookup = (e) => { e.preventDefault(); lookupCode(normalized); };
  const onScanned = useCallback((text) => { setScanning(false); setCode(cleanCode(text)); lookupCode(text); }, [lookupCode]);

  const confirmPayment = async () => {
    setError(null);
    setState('claiming');
    try {
      const res = await api.post(`/api/counter/payment/${encodeURIComponent(payment.code)}/confirm`);
      setPayment({ ...payment, ...res.data.payment, status: 'Completed' });
      setState('claimed');
      loadMe();
    } catch (err) {
      if (handleAuth(err)) return;
      setError(apiErrorMessage(err, tk('Could not confirm this payment.')));
      setState('idle');
    }
  };

  const payable = payment && payment.status === 'Pending';

  return (
    <AppShell footer={false}>
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-amber-100 text-amber-700 p-3 rounded-xl"><Store aria-hidden="true" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{me?.vendor ? localized(me.vendor, 'name', lang) : t('Campus counter')}</h1>
            <p className="text-sm text-gray-500">
              {me?.vendor
                ? <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {me.vendor.location || t('Campus counter')}</span>
                : me ? t('Admin: all counters') : t('Scan a student\'s payment QR and confirm the amount.')}
            </p>
          </div>
        </div>

        {meError && <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{meError}</p>}

        {!scanning && (
          <button onClick={() => { setScanning(true); setError(null); }} className="w-full py-4 rounded-2xl text-lg font-bold bg-green-600 text-white hover:bg-green-700 shadow-sm flex items-center justify-center gap-2">
            <ScanQrCode size={22} aria-hidden="true" /> {t('Scan the student\'s QR')}
          </button>
        )}
        {scanning && <QrScan onCode={onScanned} onClose={() => setScanning(false)} />}

        <p className="mt-5 mb-2 text-xs font-semibold text-gray-500 text-center">{t('or type the code')}</p>
        <form onSubmit={lookup} className="flex gap-2">
          <label className="sr-only" htmlFor="payment-code">{t('Payment code')}</label>
          <input
            id="payment-code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setState('idle'); }}
            placeholder="NP-ABCD-2345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="flex-1 p-3 rounded-xl border border-gray-300 bg-white font-mono text-lg tracking-wider uppercase focus:ring-2 focus:ring-green-500 outline-none"
          />
          <button type="submit" disabled={!normalized || state === 'looking'} className="px-5 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
            {state === 'looking' ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} aria-hidden="true" />}
            <span className="hidden sm:inline">{t('Check')}</span>
          </button>
        </form>

        {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

        {payment && (
          <div className={`mt-6 rounded-2xl border p-6 bg-white ${payable ? 'border-green-300' : 'border-gray-200'}`}>
            <div className="flex items-start gap-3">
              {state === 'claimed' ? <CheckCircle2 className="text-green-600 flex-shrink-0" size={28} aria-hidden="true" />
                : payable ? <IndianRupee className="text-green-600 flex-shrink-0" size={28} aria-hidden="true" />
                  : <XCircle className="text-red-500 flex-shrink-0" size={28} aria-hidden="true" />}
              <div className="min-w-0">
                <p className="text-3xl font-extrabold text-gray-900">₹{payment.amount_inr}</p>
                <p className="font-mono text-sm text-gray-600">{payment.code}</p>
                <p className="text-sm text-gray-500 mt-1">{t('From {name}', { name: payment.userName || t('a student') })}</p>
                <p className={`mt-2 inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${payable ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {t(PAY_STATUS_LABEL[payment.status] || payment.status)}
                </p>
                {!payable && state !== 'claimed' && (
                  <p className="mt-2 text-sm text-red-600">
                    {payment.status === 'Completed' ? t('Already paid on {date}. Do not accept it again.', { date: formatDateTime(payment.completed_at) })
                      : payment.status === 'Expired' ? t('This code has expired. Ask the student to create a new one.')
                        : t('This code is not valid any more.')}
                  </p>
                )}
              </div>
            </div>
            {payable && state !== 'claimed' && (
              <button onClick={confirmPayment} disabled={state === 'claiming'} className="mt-5 w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {state === 'claiming' && <Loader2 size={18} className="animate-spin" />} {t('Confirm ₹{n} received', { n: payment.amount_inr })}
              </button>
            )}
            {state === 'claimed' && <p role="status" className="mt-4 text-sm font-semibold text-green-700">{t('Paid. ₹{n} was taken from the student\'s campus wallet.', { n: payment.amount_inr })}</p>}
          </div>
        )}

        {me && (
          <div className="mt-8">
            <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-1"><IndianRupee size={18} aria-hidden="true" /> {t('Payments today')}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {me.vendor?.dailyLimitInr
                ? t('₹{n} of ₹{limit} today', { n: me.paymentsInr, limit: me.vendor.dailyLimitInr })
                : t('₹{n} today', { n: me.paymentsInr })}
            </p>
            {(me.payments || []).length === 0 ? <p className="text-sm text-gray-400">{t('No payments yet today.')}</p> : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl bg-white">
              {me.payments.map((p) => (
                <li key={p.code} className="p-3 flex justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800">₹{p.amount_inr}</p>
                    <p className="text-xs text-gray-500 font-mono">{p.code} · {p.userName || t('a student')}</p>
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">{formatDateTime(p.completed_at)}</span>
                </li>
              ))}
            </ul>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}
