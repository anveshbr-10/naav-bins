import React, { useState } from 'react';
import { Loader2, Undo2, Search } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { formatDateTime, formatInr } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, Pill, buttonGhost, inputClass } from './ui';

const STATUS = {
  Pending: [tk('Waiting'), 'bg-amber-50 text-amber-700 border-amber-200'],
  Completed: [tk('Paid'), 'bg-green-50 text-green-700 border-green-200'],
  Expired: [tk('Expired'), 'bg-slate-100 text-slate-600 border-slate-200'],
  Cancelled: [tk('Cancelled'), 'bg-slate-100 text-slate-600 border-slate-200'],
  Refunded: [tk('Refunded'), 'bg-red-50 text-red-700 border-red-200'],
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Campus-wallet payments at counters. Admins can refund a completed payment once, within the refund
// window and with a reason (the ₹ goes back to the student's wallet).
export default function PaymentsPanel() {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [scope, setScope] = useState('completed');
  const [vendor, setVendor] = useState('');
  const [search, setSearch] = useState('');
  const { status, data, reload } = useAdminData('/api/admin/payments', {
    ...(scope === 'all' ? { scope: 'all' } : {}),
    ...(vendor ? { vendor } : {}),
  });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const refund = async (code) => {
    const input = window.prompt(t("Refund this payment? The money goes back to the student's wallet. Reason (required):"));
    if (input === null) return;
    const reason = input.trim();
    if (reason.length < 3 || reason.length > 200) {
      setError(t('Please give a reason for the refund (3–200 characters).'));
      return;
    }
    setBusy(code);
    setError(null);
    try {
      await api.post(`/api/admin/payments/${code}/refund`, { reason });
      reload();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not refund.')));
    } finally {
      setBusy(null);
    }
  };

  // Counter and status are filtered by the server; the search box narrows the loaded rows.
  const term = search.trim().toLowerCase();
  const rows = (data?.payments || []).filter((p) => !term
    || [p.code, p.userName, p.userEmail, p.staff_email].some((v) => String(v || '').toLowerCase().includes(term)));
  const totalInr = rows.reduce((s, p) => s + (p.status === 'Completed' ? Number(p.amount_inr) || 0 : 0), 0);
  const windowDays = data?.refundWindowDays ?? 7;
  const now = Date.now();
  const refundable = (p) => p.status === 'Completed' && p.completed_at && now - Date.parse(p.completed_at) <= windowDays * DAY_MS;
  return (
    <Panel
      title={t('Campus wallet payments')}
      subtitle={t('Exact-amount payments confirmed at campus counters. Refund only if the counter made a mistake: within {n} days, with a reason.', { n: windowDays })}
    >
      {/* Filters: search the loaded rows; counter and status are filtered by the server. */}
      <div className="px-4 sm:px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-col lg:flex-row lg:items-end gap-3">
        <label className="block flex-1 min-w-0">
          <span className="text-xs font-semibold text-slate-600">{t('Search payments')}</span>
          <span className="relative block mt-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search code, student or staff email')} className={`${inputClass} pl-9`} />
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3 lg:w-[28rem]">
          <label className="block min-w-0">
            <span className="text-xs font-semibold text-slate-600">{t('Counter')}</span>
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">{t('All counters')}</option>
              {(data?.vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-xs font-semibold text-slate-600">{t('Show')}</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="completed">{t('Completed')}</option>
              <option value="all">{t('All (incl. expired and cancelled)')}</option>
            </select>
          </label>
        </div>
        {data && (
          <div className="flex gap-5 lg:pl-4 lg:border-l lg:border-slate-200" aria-live="polite">
            <div>
              <p className="text-xs font-semibold text-slate-600">{t('Payments')}</p>
              <p className="mt-1 text-lg font-bold text-slate-800 leading-[2.6rem]">{rows.length}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">{t('Paid')}</p>
              <p className="mt-1 text-lg font-bold text-green-700 leading-[2.6rem] whitespace-nowrap">{formatInr(totalInr)}</p>
            </div>
          </div>
        )}
      </div>
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
                    <td className="p-3"><Pill className={style}>{t(label)}</Pill>{p.refunded_by && <p className="text-xs text-slate-400 mt-1">{t('by {who}', { who: p.refunded_by })}</p>}{p.refund_reason && <p className="text-xs text-slate-500 mt-0.5 max-w-[16rem] break-words">{p.refund_reason}</p>}</td>
                    <td className="p-3 text-xs text-slate-500">{formatDateTime(p.completed_at || p.created_at)}</td>
                    <td className="p-3 text-right">
                      {refundable(p) && (
                        <button onClick={() => refund(p.code)} disabled={busy === p.code} className={`${buttonGhost} text-red-600`}>
                          {busy === p.code ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} {t('Refund')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan="7" className="p-8 text-center text-slate-400">{term || vendor ? t('No payments match these filters.') : t('No payments yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
