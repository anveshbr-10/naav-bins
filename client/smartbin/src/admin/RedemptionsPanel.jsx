import React, { useState } from 'react';
import { Landmark, Ticket, Loader2 } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { formatDateTime, formatInr } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError } from './ui';

// Which decisions apply to a redemption (mirrors the server's allowed transitions).
function actionsFor(r) {
  if (r.type === 'money' && r.status === 'Pending') {
    return [{ status: 'Paid', label: tk('Mark paid'), tone: 'primary' }, { status: 'Rejected', label: tk('Reject & refund'), tone: 'danger' }];
  }
  if (r.type === 'points' && r.status === 'Issued') {
    return [{ status: 'Claimed', label: tk('Mark claimed'), tone: 'primary' }, { status: 'Cancelled', label: tk('Cancel & refund'), tone: 'danger' }];
  }
  return [];
}

// Two-step buttons: pick a decision, then confirm it inline.
export function RedemptionActions({ redemption, onDone }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const actions = actionsFor(redemption);
  if (!actions.length) return null;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/redemptions/status', { code: redemption.code, status: confirming.status });
      setConfirming(null);
      onDone();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not update the redemption.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-xs text-slate-500">{t(confirming.label)}?</span>
          <button onClick={apply} disabled={busy}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 ${confirming.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-60`}>
            {busy && <Loader2 size={12} className="animate-spin" />} {t('Confirm')}
          </button>
          <button onClick={() => setConfirming(null)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200">{t('Cancel')}</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {actions.map((a) => (
            <button key={a.status} onClick={() => setConfirming(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${a.tone === 'danger' ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}>
              {t(a.label)}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function RedemptionsPanel({ onChanged }) {
  const { t } = useI18n();
  const { status, data, reload } = useAdminData('/api/admin/redemptions');
  const done = () => { reload(); onChanged?.(); };
  // Withdrawals (money owed) first, then vouchers; oldest first within each.
  const queue = [...(data?.redemptions || [])].sort((a, b) =>
    (a.type === b.type ? 0 : a.type === 'money' ? -1 : 1) || String(a.created_at).localeCompare(String(b.created_at)));

  return (
    <Panel title={t('Redemption queue')} subtitle={t('UPI withdrawals to pay and campus-credit codes not yet used. Rejecting or cancelling refunds the user.')}>
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {data && (queue.length === 0 ? (
        <p className="p-8 text-center text-slate-400">{t('Nothing waiting. 🎉')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {queue.map((r) => (
            <li key={r.code} className="p-4 md:px-6 flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${r.type === 'money' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                  {r.type === 'money' ? <Landmark size={18} /> : <Ticket size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">
                    {r.type === 'money' ? t('Withdraw {amount} → {upi}', { amount: formatInr(r.cost), upi: r.upi_id }) : t('{item} ({n} pts)', { item: r.item, n: r.cost })}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {r.userName || r.userEmail} · {r.userEmail} · {formatDateTime(r.created_at)} · <span className="font-mono">{r.code}</span>
                  </p>
                </div>
              </div>
              <RedemptionActions redemption={r} onDone={done} />
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}
