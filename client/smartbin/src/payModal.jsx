import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { X, Loader2, Store, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import api, { apiErrorMessage } from './api';
import { useI18n, localized, tk } from './i18n';
import useDialog from './useDialog';

const QUICK_AMOUNTS = [2, 5, 10, 20, 50, 100];

// Pay any exact amount from the campus wallet at a campus counter.
// 1. Choose the counter and the amount. 2. Show the one-time QR / code (valid 3 minutes).
// 3. The counter confirms it; this screen polls and shows the result. Money moves only on confirm.
// Spends the ₹ campus wallet. Eco-Points must be redeemed into it first (onNeedMoney opens that).
export default function PayModal({ onClose, onPaid, onNeedMoney }) {
  const { t, lang } = useI18n();
  const [snap, setSnap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState(null);
  const [qr, setQr] = useState(null);
  const [phase, setPhase] = useState('form'); // form | creating | waiting | done | expired
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = phase === 'creating';
  const dialogRef = useDialog(onClose, !busy);
  const paidRef = useRef(false);

  const show = useCallback(async (p) => {
    setPayment(p);
    setPhase('waiting');
    try { setQr(await QRCode.toDataURL(p.qr, { margin: 1, width: 240 })); } catch { setQr(null); }
  }, []);

  useEffect(() => {
    api.get('/api/wallet')
      .then((res) => {
        setSnap(res.data);
        if (res.data.vendors?.length === 1) setVendorId(res.data.vendors[0].id);
        if (res.data.openPayment) show(res.data.openPayment);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, tk('Could not load your campus wallet.'))));
  }, [show]);

  // Countdown + polling while the code is live.
  useEffect(() => {
    if (phase !== 'waiting' || !payment) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      api.get(`/api/pay/${payment.code}`).then((res) => {
        const st = res.data.payment.status;
        if (st === 'Completed' && !paidRef.current) { paidRef.current = true; setPayment(res.data.payment); setPhase('done'); onPaid?.(); }
        else if (st === 'Expired' || st === 'Cancelled') setPhase('expired');
      }).catch(() => { /* keep trying */ });
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [phase, payment, onPaid]);

  const vendors = snap?.vendors || [];
  const vendor = vendors.find((v) => v.id === vendorId);
  const amountNum = Number(amount);
  const validAmount = Number.isInteger(amountNum) && amountNum >= 1 && (!vendor || amountNum <= vendor.maxTxnInr);
  const enough = snap ? amountNum <= snap.wallet.inr : false;

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    setPhase('creating');
    try {
      const res = await api.post('/api/pay/create', { vendorId, amountInr: amountNum });
      await show(res.data.payment);
    } catch (err) {
      setError(apiErrorMessage(err, tk('Could not create the payment code.')));
      setPhase('form');
    }
  };

  const cancel = async () => {
    if (payment && phase === 'waiting') {
      try { await api.post(`/api/pay/${payment.code}/cancel`); } catch { /* it expires anyway */ }
    }
    onClose();
  };

  const secondsLeft = payment ? Math.max(0, Math.round((Date.parse(payment.expires_at) - now) / 1000)) : 0;
  const vendorName = (id) => { const v = vendors.find((x) => x.id === id); return v ? localized(v, 'name', lang) : ''; };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !busy && cancel()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pay-title"
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 relative outline-none max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <button onClick={cancel} disabled={busy} aria-label={t('Close')} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"><X size={20} /></button>
        <h2 id="pay-title" className="text-xl font-bold text-gray-900 flex items-center gap-2 pr-8"><Store size={20} className="text-green-700" aria-hidden="true" /> {t('Pay at a campus counter')}</h2>

        {loadError && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{loadError}</p>}
        {!snap && !loadError && <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div>}

        {snap && (phase === 'form' || phase === 'creating') && (
          <form onSubmit={create} className="mt-4 space-y-4">
            <div className="rounded-xl bg-green-50 border border-green-200 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-green-800">{t('Wallet balance')}</p>
                <p className="text-2xl font-extrabold text-green-700">₹{snap.wallet.inr}</p>
              </div>
              {onNeedMoney && snap.wallet.redeemableInr > 0 && (
                <button type="button" onClick={onNeedMoney} className="text-xs font-bold px-3 py-2 rounded-lg bg-white border border-green-300 text-green-700 hover:bg-green-100">
                  {t('Redeem Eco-Points')}
                </button>
              )}
            </div>
            <p className="text-sm text-gray-600">{t('Pay exactly what you need; the rest stays in your wallet.')}</p>
            <fieldset>
              <legend className="text-xs font-semibold text-gray-600 mb-2">{t('Counter')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {vendors.map((v) => (
                  <button type="button" key={v.id} onClick={() => setVendorId(v.id)} aria-pressed={vendorId === v.id}
                    className={`p-3 rounded-xl border text-left text-sm ${vendorId === v.id ? 'border-green-600 bg-green-50 ring-2 ring-green-500' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <span className="font-bold text-gray-800 block leading-tight">{localized(v, 'name', lang)}</span>
                    {v.location && <span className="text-[11px] text-gray-500">{v.location}</span>}
                  </button>
                ))}
              </div>
              {!vendors.length && <p className="text-sm text-gray-500">{t('No counters are open right now.')}</p>}
            </fieldset>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">{t('Amount (₹)')}</span>
              <input type="number" inputMode="numeric" min="1" step="1" max={vendor?.maxTxnInr || undefined} value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="2"
                className="w-full p-3 rounded-xl border border-gray-300 bg-white text-2xl font-bold text-gray-900 focus:ring-2 focus:ring-green-500 outline-none" />
            </label>
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button type="button" key={a} onClick={() => setAmount(String(a))} className="px-3 py-1.5 rounded-full text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">₹{a}</button>
              ))}
            </div>
            {amount !== '' && (
              <p className={`text-sm ${validAmount && enough ? 'text-gray-600' : 'text-red-600'}`}>
                {!validAmount
                  ? t('Enter a whole amount from ₹1 to ₹{max}.', { max: vendor?.maxTxnInr || 500 })
                  : enough ? t('₹{n} left after paying', { n: snap.wallet.inr - amountNum })
                    : t('Not enough in your campus wallet: you have ₹{have}. Redeem Eco-Points to add money.', { have: snap.wallet.inr })}
              </p>
            )}
            {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
            <button type="submit" disabled={!vendorId || !validAmount || !enough || busy}
              className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 size={18} className="animate-spin" />} {t('Get payment code')}
            </button>
          </form>
        )}

        {phase === 'waiting' && payment && (
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">{t('Show this at {place}. Staff scan it or type the code.', { place: vendorName(payment.vendor_id) || payment.vendorName || t('the counter') })}</p>
            <p className="text-4xl font-extrabold text-gray-900 mt-3">₹{payment.amount_inr}</p>
            {qr && <img src={qr} alt={t('Payment QR code')} className="mx-auto my-4 w-56 h-56 rounded-xl border border-gray-200 bg-white p-2" />}
            <p className="font-mono text-2xl font-bold tracking-widest text-gray-900">{payment.code}</p>
            <p className={`mt-3 text-sm flex items-center justify-center gap-1 ${secondsLeft < 30 ? 'text-red-600' : 'text-gray-500'}`}>
              <Clock size={14} aria-hidden="true" /> {t('Valid for {m}:{s}', { m: Math.floor(secondsLeft / 60), s: String(secondsLeft % 60).padStart(2, '0') })}
            </p>
            <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1"><Loader2 size={12} className="animate-spin" /> {t('Waiting for the counter to confirm…')}</p>
            <button onClick={cancel} className="mt-5 w-full py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">{t('Cancel payment')}</button>
          </div>
        )}

        {phase === 'done' && payment && (
          <div className="mt-6 text-center" role="status">
            <CheckCircle2 className="mx-auto text-green-600" size={56} aria-hidden="true" />
            <p className="text-2xl font-extrabold text-gray-900 mt-3">{t('Paid ₹{n}', { n: payment.amount_inr })}</p>
            <p className="text-sm text-gray-500">{t('Paid from your campus wallet.')}</p>
            <button onClick={onClose} className="mt-6 w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700">{t('Done')}</button>
          </div>
        )}

        {phase === 'expired' && (
          <div className="mt-6 text-center" role="alert">
            <AlertTriangle className="mx-auto text-amber-500" size={48} aria-hidden="true" />
            <p className="font-bold text-gray-900 mt-3">{t('This code is no longer valid. Nothing was deducted.')}</p>
            <button onClick={() => { setPayment(null); setQr(null); setPhase('form'); }} className="mt-5 w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700">{t('Create a new code')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
