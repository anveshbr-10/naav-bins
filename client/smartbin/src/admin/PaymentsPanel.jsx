import React, { useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { formatDateTime, formatInr } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, Pill, buttonGhost } from './ui';

const STATUS = {
  Pending: [tk('Waiting'), 'bg-amber-50 text-amber-700 border-amber-200'],
  Completed: [tk('Paid'), 'bg-green-50 text-green-700 border-green-200'],
  Expired: [tk('Expired'), 'bg-slate-100 text-slate-600 border-slate-200'],
  Cancelled: [tk('Cancelled'), 'bg-slate-100 text-slate-600 border-slate-200'],
  Refunded: [tk('Refunded'), 'bg-red-50 text-red-700 border-red-200'],
};

// Campus-wallet payments at counters. Admins can refund a completed payment once (the ₹ goes back to the student's wallet).
export default function PaymentsPanel() {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [scope, setScope] = useState('completed');
  const { status, data, reload } = useAdminData('/api/admin/payments', scope === 'all' ? { scope: 'all' } : {});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const refund = async (code) => {
    if (!window.confirm(t("Refund this payment? The money goes back to the student's wallet."))) return;
    setBusy(code);
    setError(null);
    try {
      await api.post(`/api/admin/payments/${code}/refund`);
      reload();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not refund.')));
    } finally {
      setBusy(null);
    }
  };

  const rows = data?.payments || [];
  return (
    <Panel
      title={t('Campus wallet payments')}
      subtitle={t('Exact-amount payments confirmed at campus counters. Refund only if the counter made a mistake.')}
      actions={
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={t('Show')} className="p-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700">
          <option value="completed">{t('Completed')}</option>
          <option value="all">{t('All (incl. expired and cancelled)')}</option>
        </select>
      }
    >
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {error && <p role="alert" className="m-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
              <tr>
                <th className="p-3">{t('Code')}</th><th className="p-3">{t('Student')}</th><th className="p-3">{t('Counter')}</th>
                <th className="p-3">{t('Amount')}</th><th className="p-3">{t('Status')}</th><th className="p-3">{t('When')}</th><th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const [label, style] = STATUS[p.status] || [p.status, STATUS.Expired[1]];
                return (
                  <tr key={p.code}>
                    <td className="p-3 font-mono text-xs">{p.code}</td>
                    <td className="p-3"><p className="font-semibold text-slate-800">{p.userName || '—'}</p><p className="text-xs text-slate-500">{p.userEmail}</p></td>
                    <td className="p-3 text-slate-600">{p.vendorName || p.vendor_id}<p className="text-xs text-slate-400">{p.staff_email || ''}</p></td>
                    <td className="p-3 font-bold text-slate-800">{formatInr(p.amount_inr)}</td>
                    <td className="p-3"><Pill className={style}>{t(label)}</Pill>{p.refunded_by && <p className="text-xs text-slate-400 mt-1">{t('by {who}', { who: p.refunded_by })}</p>}</td>
                    <td className="p-3 text-xs text-slate-500">{formatDateTime(p.completed_at || p.created_at)}</td>
                    <td className="p-3 text-right">
                      {p.status === 'Completed' && (
                        <button onClick={() => refund(p.code)} disabled={busy === p.code} className={`${buttonGhost} text-red-600`}>
                          {busy === p.code ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} {t('Refund')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan="7" className="p-8 text-center text-slate-400">{t('No payments yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
