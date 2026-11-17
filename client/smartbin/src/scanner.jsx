import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import * as tmImage from '@teachablemachine/image';
import Webcam from 'react-webcam';
import { useNavigate } from 'react-router-dom';
import api, { apiErrorMessage, apiStatus } from './api';
import { useAuth } from './authContext';
import { useI18n, tk } from './i18n';
import AppShell from './layout';
import { BRAND_NAME } from './brand';
import { WASTE_BY_MODEL, streamOf } from './waste';
import {
  Loader2, ScanQrCode, Camera, CheckCircle2, Flashlight, FlashlightOff, RefreshCw, MapPin, AlertTriangle, LocateFixed,
} from 'lucide-react';

const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/SbH77oNkD/';
const CONFIDENCE_THRESHOLD = 0.8;
const LOW_LIGHT_LUMA = 60; // average brightness (0–255) below which the scene counts as dark
const VIDEO_CONSTRAINTS = { facingMode: { ideal: 'environment' } };
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 };
const LOCATION_WAIT_MS = 10000;
const THUMB = 32;

// The model is downloaded once per page load and reused for every capture.
let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    modelPromise = tmImage
      .load(MODEL_URL + 'model.json', MODEL_URL + 'metadata.json')
      .catch((err) => { modelPromise = null; throw err; }); // allow a retry after a failure
  }
  return modelPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Average brightness of the current video frame, sampled at low resolution.
function averageLuma(video, canvas) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const w = 32, h = 24;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

// 32×32 grayscale thumbnail of the capture (centre square), base64. The server computes a perceptual
// hash from it to reject repeated photos of the same item. Downscaled in two steps so it is smooth.
function grayscaleThumbnail(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = Math.min(w, h);
  const mid = document.createElement('canvas');
  mid.width = mid.height = 128;
  const mctx = mid.getContext('2d');
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 128, 128);
  const out = document.createElement('canvas');
  out.width = out.height = THUMB;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(mid, 0, 0, THUMB, THUMB);
  const { data } = octx.getImageData(0, 0, THUMB, THUMB);
  let bin = '';
  for (let i = 0; i < data.length; i += 4) {
    bin += String.fromCharCode(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
  }
  return btoa(bin);
}

export default function Scanner() {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState({ key: tk('Point the camera at your item') });
  const [detected, setDetected] = useState(null); // material + server-confirmed reward / stream
  const [isProcessing, setIsProcessing] = useState(false);
  const [qrError, setQrError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0); // bump to restart the QR camera
  const [scanToken, setScanToken] = useState(null);  // short-lived, single-use proof of a verified bin scan
  const [bin, setBin] = useState(null);              // { id, name, stream }
  const [needsRescan, setNeedsRescan] = useState(false);
  const [plannedBin] = useState(() => localStorage.getItem('current_bin_location'));
  const [modelState, setModelState] = useState('loading'); // loading | ready | error
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [lowLight, setLowLight] = useState(false);
  const [geo, setGeo] = useState(() => ('geolocation' in navigator ? { state: 'locating' } : { state: 'unavailable' }));

  const webcamRef = useRef(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const torchControlRef = useRef(null);   // async (on: boolean) => void, for whichever camera is active
  const torchOnRef = useRef(false);
  const torchManualRef = useRef(false);   // once the user toggles the flash, auto mode stops
  const cameraChainRef = useRef(Promise.resolve()); // serialises camera start/stop
  const redirectTimerRef = useRef(null);
  const positionRef = useRef(null);
  const positionWaitersRef = useRef([]);

  // --- Location: warmed up as soon as the page opens, so a fix is ready when the QR is read. ---
  useEffect(() => {
    if (!('geolocation' in navigator)) return undefined;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        positionRef.current = p;
        setGeo({ state: 'ok', accuracy: Math.round(p.accuracy) });
        positionWaitersRef.current.splice(0).forEach((resolve) => resolve(p));
      },
      (err) => {
        setGeo({ state: err && err.code === 1 ? 'denied' : 'unavailable' });
        positionWaitersRef.current.splice(0).forEach((resolve) => resolve(null));
      },
      GEO_OPTIONS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const currentPosition = useCallback(() => {
    if (positionRef.current) return Promise.resolve(positionRef.current);
    if (!('geolocation' in navigator)) return Promise.resolve(null); // the server explains what is needed
    return new Promise((resolve) => {
      positionWaitersRef.current.push(resolve);
      setTimeout(() => resolve(positionRef.current), LOCATION_WAIT_MS);
    });
  }, []);

  const setTorchOn = useCallback(async (on) => {
    const control = torchControlRef.current;
    if (!control) return;
    try {
      await control(on);
      torchOnRef.current = on;
      setTorch({ supported: true, on });
    } catch {
      torchControlRef.current = null;
      torchOnRef.current = false;
      setTorch({ supported: false, on: false });
    }
  }, []);

  const toggleTorch = () => {
    torchManualRef.current = true;
    setTorchOn(!torchOnRef.current);
  };

  useEffect(() => () => clearTimeout(redirectTimerRef.current), []);

  // --- STEP 1: QR SCANNER ---
  useEffect(() => {
    if (step !== 1) return undefined;

    let cancelled = false;
    let handled = false;
    const html5QrCode = new Html5Qrcode('reader');

    const stopScanner = () =>
      (html5QrCode.isScanning ? html5QrCode.stop() : Promise.resolve())
        .catch(() => {})
        .then(() => { try { html5QrCode.clear(); } catch { /* already cleared */ } });

    // The server checks the QR signature (printed or live code), the bin's status and that the
    // phone is at the bin, then issues a scan session.
    const verifyBin = async (decodedText) => {
      setVerifying(true);
      try {
        const location = await currentPosition();
        const res = await api.post('/api/scan/start', { qr: decodedText, location });
        setScanToken(res.data.scanToken);
        setBin(res.data.bin || null);
        setNeedsRescan(false);
        setStep(2);
      } catch (err) {
        if (apiStatus(err) === 401) { signOut().then(() => navigate('/login')); return; }
        setQrError(apiErrorMessage(err, tk('Could not verify this bin. Please try again.')));
      } finally {
        setVerifying(false);
      }
    };

    const onDecode = (decodedText) => {
      if (handled || cancelled) return;
      handled = true;
      torchControlRef.current = null;
      stopScanner().then(() => verifyBin(decodedText));
    };

    // Wait for any previous camera session to fully stop before starting a new one.
    const run = cameraChainRef.current.then(async () => {
      if (cancelled) return;
      try {
        await html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, onDecode, () => {});
      } catch (err) {
        console.error('Camera start failed', err);
        if (!cancelled) setQrError(t('Camera failed to start. Please allow camera access and try again.'));
        return;
      }
      if (cancelled) return;
      try {
        const torchFeature = html5QrCode.getRunningTrackCameraCapabilities().torchFeature();
        if (torchFeature.isSupported()) {
          torchControlRef.current = (on) => torchFeature.apply(on);
          setTorch({ supported: true, on: false });
        }
      } catch { /* torch not available on this device */ }
    });

    return () => {
      cancelled = true;
      torchControlRef.current = null;
      torchOnRef.current = false;
      setTorch({ supported: false, on: false });
      cameraChainRef.current = run.then(stopScanner);
    };
  // `t` is only used for an error message; restarting the camera on a language change is not wanted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, scanAttempt, navigate, signOut, currentPosition]);

  // --- STEP 2: preload the AI model as soon as the item camera opens ---
  useEffect(() => {
    if (step !== 2) return undefined;
    let active = true;
    loadModel()
      .then(() => { if (active) setModelState('ready'); })
      .catch(() => { if (active) setModelState('error'); });
    return () => { active = false; };
  }, [step]);

  // --- STEP 2: low-light detection; switches the flash on automatically when it is dark ---
  useEffect(() => {
    if (step !== 2) return undefined;
    const canvas = document.createElement('canvas');
    const id = setInterval(() => {
      const luma = averageLuma(webcamRef.current?.video, canvas);
      if (luma === null) return;
      const dark = luma < LOW_LIGHT_LUMA;
      setLowLight(dark);
      if (dark && torchControlRef.current && !torchManualRef.current && !torchOnRef.current) setTorchOn(true);
    }, 1500);
    return () => clearInterval(id);
  }, [step, setTorchOn]);

  const handleUserMedia = useCallback((stream) => {
    const track = stream?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.() || {};
    torchOnRef.current = false;
    if (caps.torch) {
      torchControlRef.current = (on) => track.applyConstraints({ advanced: [{ torch: on }] });
      setTorch({ supported: true, on: false });
    } else {
      torchControlRef.current = null;
      setTorch({ supported: false, on: false });
    }
  }, []);

  const retryModel = () => {
    setModelState('loading');
    loadModel().then(() => setModelState('ready')).catch(() => setModelState('error'));
  };

  const rescan = () => {
    clearTimeout(redirectTimerRef.current);
    setQrError(null);
    setScanToken(null);
    setBin(null);
    setDetected(null);
    setNeedsRescan(false);
    setIsProcessing(false);
    setLowLight(false);
    setStatus({ key: tk('Point the camera at your item') });
    setStep(1);
    setScanAttempt((n) => n + 1);
  };

  const tryAnotherItem = () => {
    setDetected(null);
    setStatus({ key: tk('Point the camera at your item') });
  };

  const failCapture = (text) => {
    setStatus({ error: text });
    setIsProcessing(false);
  };

  // --- STEP 2: AI CAPTURE ---
  const capture = async () => {
    if (!webcamRef.current || isProcessing || !scanToken) return;

    setIsProcessing(true);
    setStatus({ key: tk('Analyzing…') });
    setDetected(null);

    let model;
    try {
      model = await loadModel();
      setModelState('ready');
    } catch {
      setModelState('error');
      failCapture(t('Could not load the AI model. Check your connection and try again.'));
      return;
    }

    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) { failCapture(t('Camera is not ready yet. Please try again.')); return; }

    let best, imageThumb;
    try {
      const img = await loadImage(imageSrc);
      imageThumb = grayscaleThumbnail(img);
      const prediction = await model.predict(img);
      best = [...prediction].sort((a, b) => b.probability - a.probability)[0];
    } catch {
      failCapture(t('Could not analyse the image. Please try again.'));
      return;
    }

    if (!best || best.probability <= CONFIDENCE_THRESHOLD) {
      failCapture(lowLight && !torchOnRef.current
        ? t('Too dark to identify. Turn on the flash or move to better light.')
        : t('Not clear. Hold the item closer, filling most of the frame.'));
      return;
    }

    const material = Object.prototype.hasOwnProperty.call(WASTE_BY_MODEL, best.className) ? WASTE_BY_MODEL[best.className] : null;
    if (!material) { failCapture(t('Not a recognised waste type. Try another angle.')); return; }

    // The server records the item and decides the reward; the result card shows only after it confirms.
    try {
      const res = await api.post('/api/add-waste', { wasteType: material.name, scanToken, imageThumb });
      const d = res.data;
      setDetected({ ...material, accepted: d.accepted, stream: d.stream, binStream: d.binStream, reward: d.rewardAdded, points: d.pointsAdded });
      setIsProcessing(false);
      if (d.accepted) {
        localStorage.removeItem('current_bin_location');
        setStatus({ key: 'identified' });
        redirectTimerRef.current = setTimeout(() => navigate('/dashboard'), 3500);
      } else {
        setStatus({ key: tk('Wrong bin for this item') });
      }
    } catch (err) {
      const code = apiStatus(err);
      if (code === 401) { signOut().then(() => navigate('/login')); return; }
      if (code === 403) setNeedsRescan(true); // scan session expired / not yours / geofence
      if (code === 409 && /already been used/.test(err?.response?.data?.i18n?.key || '')) setNeedsRescan(true);
      failCapture(apiErrorMessage(err, tk('Could not record this item. Please try again.')));
    }
  };

  const renderTorchButton = (className = '') => (
    <button
      type="button"
      onClick={toggleTorch}
      aria-label={torch.on ? t('Turn flash off') : t('Turn flash on')}
      className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold backdrop-blur transition ${torch.on
        ? 'bg-yellow-300 text-black'
        : 'bg-slate-900/70 text-white border border-slate-600'} ${className}`}
    >
      {torch.on ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
      {torch.on ? t('Flash on') : t('Flash off')}
    </button>
  );

  const geoLine = {
    locating: { cls: 'text-slate-400', text: t('Finding your location…') },
    ok: { cls: 'text-emerald-400', text: t('Location ready (±{m} m)', { m: geo.accuracy }) },
    denied: { cls: 'text-amber-300', text: t('Location is blocked. Allow it so we can confirm you are at the bin.') },
    unavailable: { cls: 'text-amber-300', text: t('Location unavailable. Turn on GPS to use the bins.') },
  }[geo.state];

  const resultStream = detected ? streamOf(detected.stream) : null;
  const binStreamInfo = bin ? streamOf(bin.stream) : null;

  return (
    <AppShell footer={false} className="bg-slate-950 flex flex-col">
    <div className="flex-1 bg-slate-950 text-white flex flex-col items-center px-4 pt-6 pb-10">

      <style>{`
        @keyframes scan-down { 0% { top: 0%; opacity: 0; } 50% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        .animate-scan-down { animation: scan-down 2s linear infinite; }
        @keyframes slideUpFade { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .result-card { animation: slideUpFade 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes progressBar { from { width: 0%; } to { width: 100%; } }
        .progress-bar { animation: progressBar 3.5s linear forwards; }
        #reader img, #reader a { display: none; }
      `}</style>

      {/* HEADER */}
      <div className="flex items-center gap-3 mb-6 w-full max-w-md">
        <div className="p-3 bg-emerald-500/20 rounded-xl">
          <ScanQrCode className="text-emerald-400 w-8 h-8" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{t('Scan a bin')}</h1>
          <p className="text-[#a3b1ac] text-sm">{t('Scan → Identify → Earn')}</p>
          <p className="text-emerald-400 text-sm font-bold flex items-center gap-1 truncate">
            <MapPin size={14} aria-hidden="true" /> {bin?.name || plannedBin || t('Scan a bin QR code to begin')}
          </p>
        </div>
      </div>

      {/* STEP 1: QR */}
      {step === 1 && (
        <div className="w-full max-w-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl mb-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
            <h2 className="text-lg font-semibold text-white mb-2">{t('Find a {brand} bin', { brand: BRAND_NAME })}</h2>
            <p className="text-[#a3b1ac] text-sm mb-6">{t('Point your camera at the QR code on the bin, or at the live code on its screen.')}</p>
            <div className="bg-black rounded-xl overflow-hidden border-2 border-dashed border-slate-700 relative h-64 md:h-80 w-full flex items-center justify-center">
              <div id="reader" className="w-full h-full"></div>
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_20px_#10b981] animate-scan-down pointer-events-none z-10"></div>
              {torch.supported && renderTorchButton('absolute bottom-3 right-3 z-20')}
              {verifying && (
                <div role="status" className="absolute inset-0 z-30 bg-slate-950/80 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-emerald-400" size={32} />
                  <p className="text-sm font-bold">{t('Checking the bin and your location…')}</p>
                </div>
              )}
            </div>
            <p className={`text-xs mt-3 flex items-center justify-center gap-1 ${geoLine.cls}`} aria-live="polite">
              <LocateFixed size={14} aria-hidden="true" /> {geoLine.text}
            </p>
            {qrError ? (
              <div className="mt-4">
                <p role="alert" className="text-red-400 text-sm font-bold">{qrError}</p>
                <button onClick={rescan} className="mt-3 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-700">
                  {t('Try again')}
                </button>
              </div>
            ) : (
              <p className="text-xs text-[#a3b1ac] mt-2 flex items-center justify-center gap-1">
                <Camera size={14} /> {t('Auto-scanning active')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* STEP 2: AI */}
      {step === 2 && (
        <div className="flex flex-col items-center w-full max-w-md">

          {/* Status bar */}
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-2xl w-full mb-4">
            <div className="flex justify-between items-center gap-2 px-4 py-2">
              <span className="text-emerald-400 font-bold text-sm flex items-center gap-2 min-w-0">
                <span aria-hidden="true">●</span>
                <span className="truncate">{t('Bin verified')}{binStreamInfo && ` · ${t(binStreamInfo.label)}`}</span>
              </span>
              {modelState === 'ready' && <span className="text-slate-500 text-xs uppercase tracking-wider flex-shrink-0">{t('AI ready')}</span>}
              {modelState === 'loading' && (
                <span className="text-slate-400 text-xs uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                  <Loader2 size={12} className="animate-spin" /> {t('Loading AI')}
                </span>
              )}
              {modelState === 'error' && (
                <button onClick={retryModel} className="text-red-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                  <RefreshCw size={12} /> {t('AI failed · Retry')}
                </button>
              )}
            </div>
          </div>

          {/* Camera */}
          <div
            className="relative rounded-2xl overflow-hidden w-full shadow-2xl transition-all duration-500"
            style={{
              border: `4px solid ${detected ? (detected.accepted ? detected.color : '#F59E0B') : '#6B7280'}`,
              boxShadow: detected ? `0 0 32px ${detected.color}55` : undefined,
            }}
          >
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              videoConstraints={VIDEO_CONSTRAINTS}
              onUserMedia={handleUserMedia}
              className="w-full object-cover h-96"
            />
            {isProcessing && !detected && (
              <div className="absolute top-0 left-0 w-full h-1 bg-white shadow-[0_0_20px_white] animate-scan-down"></div>
            )}
            {torch.supported && !detected && renderTorchButton('absolute top-3 left-3')}
            {lowLight && !torch.on && !detected && (
              <div className="absolute bottom-3 left-3 right-3 text-center text-xs font-bold bg-slate-900/80 text-yellow-300 rounded-lg py-2 px-3">
                {torch.supported ? t('Low light — turn on the flash for a better result') : t('Low light — move to a brighter spot')}
              </div>
            )}
            {detected?.accepted && (
              <div className="absolute top-3 right-3">
                <CheckCircle2 className="w-8 h-8 drop-shadow-lg" style={{ color: detected.color }} />
              </div>
            )}
          </div>

          {/* Status text — only when not identified */}
          {!detected && (
            <p aria-live="polite" className="text-xl font-bold text-white mt-6 mb-2 text-center">
              {status.error ? `❌ ${status.error}` : t(status.key)}
            </p>
          )}

          {/* RESULT: accepted */}
          {detected?.accepted && (
            <div role="status" className="result-card w-full mt-5 rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#0f172a', border: `1px solid ${detected.color}44` }}>
              <div className="h-1 w-full" style={{ background: `linear-gradient(to right, ${detected.color}, transparent)` }} />
              <div className="p-5 flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0" style={{ background: `${detected.color}18`, border: `1px solid ${detected.color}44` }}>
                  {detected.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase tracking-widest font-semibold mb-0.5" style={{ color: detected.color }}>{t('Waste identified')}</p>
                  <p className="text-xl font-bold text-white leading-tight">{t(detected.label)}</p>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {t(resultStream.label)} · {detected.binStream === 'station'
                      ? t('Use the {bin} compartment', { bin: t(resultStream.bin) })
                      : t('Drop it in this bin')}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-2xl font-extrabold" style={{ color: detected.color }}>+₹{detected.reward}</p>
                  <p className="text-slate-500 text-xs">{t('+{n} pts', { n: detected.points })}</p>
                </div>
              </div>
              <div className="h-0.5 bg-slate-800 mx-5 mb-4 rounded-full overflow-hidden">
                <div className="progress-bar h-full rounded-full" style={{ background: detected.color }} />
              </div>
              <p className="text-center text-slate-500 text-xs pb-4">{t('Redirecting to dashboard…')}</p>
            </div>
          )}

          {/* RESULT: wrong stream for this bin (BBMP segregation) — nothing credited, scan still valid */}
          {detected && !detected.accepted && (
            <div role="alert" className="result-card w-full mt-5 rounded-2xl p-5 shadow-2xl bg-amber-950/60 border border-amber-500/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-amber-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-bold text-amber-200">
                    {t('{item} is {stream}.', { item: t(detected.label), stream: t(resultStream.label).toLowerCase() })}
                  </p>
                  <p className="text-sm text-amber-100/90 mt-1">
                    {t('This bin only takes {stream}. Please use a {bin} instead — find one on the map.', {
                      stream: t(streamOf(detected.binStream).label).toLowerCase(),
                      bin: t(resultStream.bin).toLowerCase(),
                    })}
                  </p>
                  <p className="text-xs text-amber-100/70 mt-2">{t('No reward for this item. Mixed waste cannot be recycled.')}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={tryAnotherItem} className="py-3 rounded-xl font-bold bg-white/10 hover:bg-white/20 text-white text-sm">{t('Scan another item')}</button>
                <button onClick={() => navigate('/map')} className="py-3 rounded-xl font-bold bg-amber-400 hover:bg-amber-300 text-black text-sm">{t('Find the right bin')}</button>
              </div>
            </div>
          )}

          {/* Re-scan prompt when the bin session is used up or expired */}
          {!detected && needsRescan && (
            <button onClick={rescan} className="mt-6 w-full py-4 rounded-xl text-lg font-bold bg-slate-800 text-white flex items-center justify-center gap-3 hover:bg-slate-700">
              <ScanQrCode /> {t('Scan bin QR again')}
            </button>
          )}

          {/* Capture button */}
          {!detected && !needsRescan && (
            <button
              onClick={capture}
              disabled={isProcessing || modelState === 'loading'}
              className={`mt-6 w-full py-4 rounded-xl text-lg font-bold shadow-lg flex items-center justify-center gap-3 transition-all transform
                ${isProcessing || modelState === 'loading'
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:scale-[1.02] active:scale-95 shadow-emerald-500/30'}`}
            >
              {isProcessing ? (
                <><Loader2 className="animate-spin" /> {t('Analyzing…')}</>
              ) : modelState === 'loading' ? (
                <><Loader2 className="animate-spin" /> {t('Loading AI…')}</>
              ) : (
                <><Camera /> {t('Capture & analyze')}</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
    </AppShell>
  );
}
