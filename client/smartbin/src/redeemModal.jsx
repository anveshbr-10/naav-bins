import React, { useState } from 'react';
import useDialog from './useDialog';
import { Loader2, X, Copy, Check, ExternalLink, Ticket, Landmark } from 'lucide-react';
import api, { apiErrorMessage, apiStatus } from './api';

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

// Confirm → submit → show the issued voucher code (points) or the pending withdrawal (money).
export default function RedeemModal({ entry, walletBalance, ecoPoints, onClose, onRedeemed, onUnauthorized }) {
  const [phase, setPhase] = useState('confirm'); // confirm | submitting | done
  const [upiId, setUpiId] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const isMoney = entry.type === 'money';
  const balance = isMoney ? walletBalance : ecoPoints;
  const shortBy = Math.max(0, entry.cost - (Number(balance) || 0));
  const costLabel = isMoney ? `₹${entry.cost}` : `${entry.cost} pts`;
  const upiValid = UPI_RE.test(upiId.trim());

  const dialogRef = useDialog(onClose, phase !== 'submitting');

  const submit = async () => {
    setError(null);
    setPhase('submitting');
    try {
      const res = await api.post('/api/redeem', { item: entry.item, ...(isMoney ? { upiId: upiId.trim() } : {}) });
      setResult(res.data.redeemed);
      setPhase('done');
      onRedeemed();
    } catch (err) {
      if (apiStatus(err) === 401) { onUnauthorized(); return; }
      setError(apiErrorMessage(err, 'Could not redeem. Please try again.'));
      setPhase('confirm');
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable; the code is still visible */ }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={() => phase !== 'submitting' && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="redeem-title"
        className="bg-white outline-none w-full max-w-md rounded-2xl shadow-2xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          disabled={phase === 'submitting'}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 disabled:opacity-40"
        >
          <X size={20} />
        </button>

        {phase !== 'done' && (
          <>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isMoney ? 'bg-green-100' : 'bg-blue-100'}`}>
              {isMoney ? <Landmark className="text-green-700" /> : <Ticket className="text-blue-600" />}
            </div>
            <h2 id="redeem-title" className="text-xl font-bold text-gray-800">
              {isMoney ? 'Request a withdrawal' : `Redeem ${entry.item}`}
            </h2>
            <p className="text-gray-500 text-sm mt-1">{entry.description}</p>

            <div className="mt-5 bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="font-bold">{costLabel}</span></div>
              <div className="flex justify-between">
                <span className="text-gray-500">Your balance</span>
                <span className="font-bold">{isMoney ? `₹${walletBalance ?? 0}` : `${ecoPoints ?? 0} pts`}</span>
              </div>
            </div>

            {isMoney && (
              <label className="block mt-5">
                <span className="text-sm font-medium text-gray-700">UPI ID to receive the money</span>
                <input
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="yourname@bank"
                  disabled={phase === 'submitting'}
                  aria-invalid={Boolean(upiId) && !upiValid}
                  aria-describedby="upi-hint"
                  className="mt-1 w-full p-3 border border-gray-300 bg-white rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                />
                {upiId && !upiValid && <span id="upi-hint" className="text-xs text-red-600">Enter a valid UPI ID, e.g. name@okaxis</span>}
              </label>
            )}

            {shortBy > 0 && (
              <p className="mt-4 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                You need {isMoney ? `₹${shortBy}` : `${shortBy} more points`} to redeem this. Keep recycling!
              </p>
            )}
            {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

            <div className="mt-6 flex gap-3">
              <button
                onClick={onClose}
                disabled={phase === 'submitting'}
                className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={phase === 'submitting' || shortBy > 0 || (isMoney && !upiValid)}
                className="flex-1 py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {phase === 'submitting' ? <><Loader2 size={18} className="animate-spin" /> Processing…</> : `Confirm · ${costLabel}`}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && result && (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-700" size={28} />
            </div>
            <h2 id="redeem-title" className="text-xl font-bold text-gray-800">
              {isMoney ? 'Withdrawal requested' : 'Voucher issued!'}
            </h2>
            <p className="text-gray-500 text-sm mt-2">
              {isMoney
                ? `₹${result.cost} will be sent to ${result.upiId} after our team reviews the request.`
                : `Show this code to the Naav Bins team to claim your ${result.item}.`}
            </p>

            <div className="mt-5 bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4">
              <p className="text-xs uppercase tracking-widest text-gray-500">{isMoney ? 'Reference' : 'Voucher code'}</p>
              <div className="flex items-center justify-center gap-3 mt-1">
                <span className="text-2xl font-mono font-extrabold tracking-wider text-gray-800">{result.code}</span>
                <button onClick={copyCode} aria-label="Copy code" className="text-gray-400 hover:text-gray-700">
                  {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Status: {result.status} · Saved in your Redemption History</p>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              {result.partnerUrl && (
                <a
                  href={result.partnerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  Open {result.partner} <ExternalLink size={16} />
                </a>
              )}
              <button onClick={onClose} className="py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
