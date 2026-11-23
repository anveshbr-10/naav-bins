import React, { useState } from 'react';
import { X, Loader2, CheckCircle2, Leaf, ArrowDown, Wallet } from 'lucide-react';
import api, { apiErrorMessage } from './api';
import { useI18n, tk } from './i18n';
import useDialog from './useDialog';

// Redeem Eco-Points into ₹ in the campus wallet (like turning coins into cash in a UPI app).
// wallet = { points, inr, pointsPerRupee, redeemableInr }
export default function ConvertModal({ wallet, onClose, onConverted }) {
  const { t } = useI18n();
  const rate = wallet.pointsPerRupee || 10;
  const max = wallet.redeemableInr || 0;
  const [amount, setAmount] = useState(String(max));
  const [phase, setPhase] = useState('form'); // form | busy | done
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const busy = phase === 'busy';
  const dialogRef = useDialog(onClose, !busy);

  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  const quick = [...new Set([10, 50, 100].filter((v) => v < max).concat(max > 0 ? [max] : []))];

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setPhase('busy');
    try {
      const res = await api.post('/api/wallet/convert', { amountInr: n });
      setResult(res.data);
      setPhase('done');
      onConverted?.();
    } catch (err) {
      setError(apiErrorMessage(err, tk('Could not redeem your Eco-Points.')));
      setPhase('form');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="convert-title"
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 relative outline-none max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} disabled={busy} aria-label={t('Close')} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"><X size={20} /></button>
        <h2 id="convert-title" className="text-xl font-bold text-gray-900 flex items-center gap-2 pr-8">
          <Leaf size={20} className="text-emerald-600" aria-hidden="true" /> {t('Redeem Eco-Points')}
        </h2>

        {phase !== 'done' ? (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-xs font-semibold text-emerald-800">{t('You have')}</p>
              <p className="text-3xl font-extrabold text-emerald-700">{wallet.points.toLocaleString('en-IN')} <span className="text-base font-bold">{t('Eco-Points')}</span></p>
              <p className="text-xs text-emerald-800 mt-1">{t('{rate} Eco-Points = ₹1', { rate })}</p>
            </div>

            {max < 1 ? (
              <p className="text-sm text-gray-600">{t('You need at least {n} Eco-Points to redeem ₹1.', { n: rate })}</p>
            ) : (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">{t('Add to wallet (₹)')}</span>
                  <input type="number" inputMode="numeric" min="1" step="1" max={max} value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="w-full p-3 rounded-xl border border-gray-300 bg-white text-2xl font-bold text-gray-900 focus:ring-2 focus:ring-green-500 outline-none" />
                </label>
                <div className="flex flex-wrap gap-2">
                  {quick.map((a) => (
                    <button type="button" key={a} onClick={() => setAmount(String(a))}
                      className="px-3 py-1.5 rounded-full text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
                      {a === max ? t('Max ₹{n}', { n: a }) : `₹${a}`}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-gray-200 p-3 text-sm" aria-live="polite">
                  {valid ? (
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="font-bold text-gray-800">−{(n * rate).toLocaleString('en-IN')} {t('Eco-Points')}</span>
                      <ArrowDown size={16} className="text-gray-400" aria-hidden="true" />
                      <span className="font-extrabold text-green-700 text-lg">+₹{n} {t('in your wallet')}</span>
                    </div>
                  ) : (
                    <p className="text-red-600">{t('Enter a whole amount from ₹1 to ₹{max}.', { max })}</p>
                  )}
                </div>
              </>
            )}

            {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
            {max >= 1 && (
              <button type="submit" disabled={!valid || busy}
                className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} aria-hidden="true" />} {valid ? t('Redeem ₹{n} to wallet', { n }) : t('Redeem to wallet')}
              </button>
            )}
            <p className="text-xs text-gray-500 text-center">{t('Wallet money can only be spent at campus counters.')}</p>
          </form>
        ) : (
          <div className="mt-6 text-center" role="status">
            <CheckCircle2 className="mx-auto text-green-600" size={56} aria-hidden="true" />
            <p className="text-2xl font-extrabold text-gray-900 mt-3">{t('₹{n} added to your wallet', { n: result.converted.inr })}</p>
            <p className="text-sm text-gray-500">{t('Wallet balance ₹{inr} · {points} Eco-Points left', { inr: result.wallet.inr, points: result.wallet.points })}</p>
            <button onClick={onClose} className="mt-6 w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700">{t('Done')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
