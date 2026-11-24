import React, { useEffect, useState } from 'react';
import { History, Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import api from './api';
import { useI18n, tk } from './i18n';
import { formatDateTime } from './format';

// Why a balance changed (points_ledger.kind / wallet_ledger.kind).
const KIND_LABEL = {
  deposit: tk('Recycled an item'),
  deposit_bonus: tk('Recycled an item + bonus unlocked'),
  challenge: tk('Weekly challenge bonus'),
  convert: tk('Redeemed Eco-Points to wallet'),
  payment: tk('Paid at a campus counter'),
  payment_refund: tk('Payment refunded'),
  adjustment: tk('Adjustment by the campus team'),
};

// Transactions of the ₹ wallet and of Eco-Points (append-only ledgers kept by the database).
export default function WalletHistory({ refreshKey }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('money');

  useEffect(() => {
    let active = true;
    api.get('/api/wallet')
      .then((res) => { if (active) { setSnap(res.data); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [refreshKey]);

  if (failed) return null; // wallet not set up yet (004 not run) — nothing to show
  const rows = !snap ? null : tab === 'money' ? (snap.walletLedger || []) : (snap.ledger || []);
  const money = tab === 'money';
  const tabBtn = (id, label) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`px-4 py-1.5 rounded-full text-sm font-bold ${tab === id ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {label}
    </button>
  );

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-xl font-bold text-gray-700 flex items-center gap-2"><History /> {t('Transactions')}</h3>
        <div role="tablist" className="flex gap-2">
          {tabBtn('money', t('Wallet ₹'))}
          {tabBtn('points', t('Eco-Points'))}
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!rows ? (
          <div className="p-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-gray-500">{money ? t('No wallet transactions yet. Redeem Eco-Points to add money.') : t('No points activity yet.')}</p>
        ) : rows.slice(0, 15).map((r, i) => {
          const plus = r.delta >= 0;
          const Icon = plus ? ArrowDownLeft : ArrowUpRight;
          return (
            <div key={`${r.created_at}-${i}`} className="p-4 border-b border-gray-100 last:border-0 flex justify-between items-center gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${plus ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800">{t(KIND_LABEL[r.kind] || KIND_LABEL.adjustment)}</p>
                  <p className="text-xs text-gray-500">{formatDateTime(r.created_at)}{r.ref && /^N[PB]-/.test(r.ref) ? ` · ${r.ref}` : ''}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-bold ${plus ? 'text-green-600' : 'text-red-600'}`}>
                  {plus ? '+' : '−'}{money ? `₹${Math.abs(r.delta)}` : t('{n} pts', { n: Math.abs(r.delta) })}
                </p>
                <p className="text-xs text-gray-400">{money ? t('Balance ₹{n}', { n: r.balance_after }) : t('Balance {n} pts', { n: r.balance_after })}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
