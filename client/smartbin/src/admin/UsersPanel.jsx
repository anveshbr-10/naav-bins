import React, { useState } from 'react';
import { Search, ArrowUpRight, Download, X, Ticket, Recycle, ShieldAlert, Ban, Store, Loader2, Scale } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import useDialog from '../useDialog';
import { formatCo2, formatCount, formatDate, formatDateTime, formatInr, formatKg } from '../format';
import { STATUS_LABEL, WASTE_BY_NAME } from '../waste';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, Pill, buttonGhost } from './ui';
import { RedemptionActions } from './RedemptionsPanel';
import { FLAG_INFO } from './flagInfo';

const ROLE_STYLE = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  vendor: 'bg-amber-100 text-amber-700 border-amber-200',
  user: 'bg-slate-100 text-slate-600 border-slate-200',
};
const ROLE_LABEL = { admin: tk('Admin'), vendor: tk('Vendor'), user: tk('User') };

// CSV cell: quote everything and neutralise spreadsheet formulas (CSV injection).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function UserDrawer({ userId, onClose, onChanged }) {
  const { t } = useI18n();
  const ref = useDialog(onClose);
  const handleAuthError = useAuthErrorHandler();
  const { status, data, reload } = useAdminData(`/api/admin/users/${userId}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (url, body) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(url, body);
      reload();
      onChanged();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not update this user.')));
    } finally {
      setBusy(false);
    }
  };

  const u = data?.user;
  return (
    <div className="fixed inset-0 z-[1050] flex justify-end bg-black/40" onClick={onClose}>
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="user-detail-title"
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 id="user-detail-title" className="text-xl font-bold text-slate-800 truncate">{u?.name || '—'}</h2>
            <p className="text-sm text-slate-500 truncate">{u?.email}</p>
            {u && <p className="text-xs text-slate-400 mt-1">{t(ROLE_LABEL[u.role] || u.role)} · {t('Joined {date}', { date: formatDate(u.createdAt) })}</p>}
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="text-slate-400 hover:text-slate-700"><X size={22} /></button>
        </div>

        {status === 'loading' && !data && <Loading />}
        {status === 'error' && <LoadError onRetry={reload} />}
        {u && (
          <>
            <div className="p-6 grid grid-cols-2 gap-3">
              {[[tk('Wallet'), formatInr(u.walletBalance)], [tk('Eco Points'), formatCount(u.ecoPoints)]].map(([label, value]) => (
                <div key={label} className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500">{t(label)}</p>
                  <p className="text-lg font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>

            {u.role !== 'admin' && (
              <div className="px-6 pb-6 flex flex-wrap gap-2">
                <button onClick={() => act(`/api/admin/users/${u.id}/block`, { blocked: !u.is_blocked })} disabled={busy} className={`${buttonGhost} ${u.is_blocked ? '' : 'text-red-600'}`}>
                  <Ban size={16} /> {u.is_blocked ? t('Resume earning') : t('Pause earning (block)')}
                </button>
                <button onClick={() => act(`/api/admin/users/${u.id}/role`, { role: u.role === 'vendor' ? 'user' : 'vendor' })} disabled={busy} className={buttonGhost}>
                  <Store size={16} /> {u.role === 'vendor' ? t('Remove counter access') : t('Give counter access (vendor)')}
                </button>
                {busy && <Loader2 size={16} className="animate-spin text-slate-400 self-center" />}
                {error && <p role="alert" className="w-full text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
              </div>
            )}

            {data.flags.length > 0 && (
              <div className="px-6 pb-6">
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><ShieldAlert size={18} /> {t('Fraud flags')}</h3>
                <ul className="space-y-2">
                  {data.flags.slice(0, 10).map((f) => (
                    <li key={f.id} className="text-sm border border-slate-100 rounded-xl p-3">
                      <p className="font-semibold text-slate-800">{t(FLAG_INFO[f.kind]?.title || f.kind)}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(f.created_at)}{f.resolution ? ` · ${f.resolution === 'confirmed' ? t('Confirmed') : t('Dismissed')}` : ` · ${t('Open')}`}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="px-6 pb-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Ticket size={18} /> {t('Redemptions')}</h3>
              {data.redemptions.length === 0 ? <p className="text-sm text-slate-400">{t('No redemptions.')}</p> : (
                <ul className="space-y-3">
                  {data.redemptions.map((r) => (
                    <li key={r.code} className="border border-slate-100 rounded-xl p-3">
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800">{r.type === 'money' ? t('Withdrawal {amount}', { amount: formatInr(r.cost) }) : `${r.item} · ${t('{n} pts', { n: r.cost })}`}</p>
                          <p className="text-xs text-slate-500">{formatDateTime(r.created_at)}</p>
                          <p className="text-xs font-mono text-slate-600">{r.code}{r.upi_id ? ` · ${r.upi_id}` : ''}</p>
                          {r.processed_by && <p className="text-xs text-slate-400">{t('by {who} · {date}', { who: r.processed_by, date: formatDateTime(r.processed_at) })}</p>}
                        </div>
                        <Pill className="bg-slate-50 border-slate-200 text-slate-600 h-fit">{t(STATUS_LABEL[r.status] || r.status)}</Pill>
                      </div>
                      <div className="mt-2"><RedemptionActions redemption={r} onDone={() => { reload(); onChanged(); }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-6 pb-10">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Recycle size={18} /> {t('Recent activity')}</h3>
              {data.logs.length === 0 ? <p className="text-sm text-slate-400">{t('No items recycled yet.')}</p> : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                  {data.logs.slice(0, 30).map((l) => (
                    <li key={l.id} className="p-3 flex justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{t(WASTE_BY_NAME[l.waste_type]?.label || l.waste_type)}{l.accepted === false && <span className="text-amber-700"> · {t('wrong stream')}</span>}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {formatDateTime(l.created_at)} · {l.bin_name || t('Unknown location')}
                          {l.gps_distance_m !== null && l.gps_distance_m !== undefined ? ` · ${t('{d} m from bin', { d: Math.round(l.gps_distance_m) })}` : ''}
                          {l.measured_weight_kg ? <> · <Scale size={11} className="inline" /> {formatKg(l.measured_weight_kg)}</> : null}
                        </p>
                      </div>
                      <span className="font-bold text-green-600 flex-shrink-0">+{formatInr(l.reward_inr)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default function UsersPanel({ onChanged }) {
  const { t } = useI18n();
  const { status, data, reload } = useAdminData('/api/admin/users');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const users = data?.users || [];
  const term = search.trim().toLowerCase();
  const filtered = users.filter((u) => String(u.name || '').toLowerCase().includes(term) || String(u.email || '').toLowerCase().includes(term));

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Role', 'Department', 'Hostel', 'Blocked', 'Joined', 'Wallet (INR)', 'Eco Points', 'Items Recycled', 'Weight (kg)', 'Est. CO2 (kg)', 'Rewards Earned (INR)', 'Pending Withdrawals (INR)', 'Open Flags'];
    const rows = filtered.map((u) => [
      u.name, u.email, u.role, u.department, u.hostel, u.is_blocked ? 'yes' : 'no', u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '',
      u.walletBalance ?? 0, u.ecoPoints ?? 0, u.impact?.items ?? 0, u.impact?.wasteKg ?? 0, u.impact?.co2Kg ?? 0, u.rewardsEarned ?? 0, u.pendingWithdrawals ?? 0, u.openFlags ?? 0,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `naav-bins-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title={t('Users')}
      subtitle={t('Everyone registered, with impact, balances and open flags.')}
      actions={
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" aria-hidden="true" />
          <input type="search" aria-label={t('Search users by name or email')} placeholder={t('Search users…')} value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2 border border-slate-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64" />
        </div>
      }
    >
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
                <tr>
                  <th className="p-4">{t('User')}</th>
                  <th className="p-4">{t('Role')}</th>
                  <th className="p-4">{t('Wallet')}</th>
                  <th className="p-4">{t('Eco Points')}</th>
                  <th className="p-4">{t('Items')}</th>
                  <th className="p-4">{t('CO₂ (est.)')}</th>
                  <th className="p-4">{t('Joined')}</th>
                  <th className="p-4 text-right">{t('Details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-indigo-50/30">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {String(u.name || u.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate">{u.name || '—'}</p>
                          <p className="text-sm text-slate-500 truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        <Pill className={ROLE_STYLE[u.role] || ROLE_STYLE.user}>{t(ROLE_LABEL[u.role] || u.role)}</Pill>
                        {u.is_blocked && <Pill className="bg-red-50 text-red-700 border-red-200">{t('Blocked')}</Pill>}
                        {u.openFlags > 0 && <Pill className="bg-amber-50 text-amber-700 border-amber-200"><ShieldAlert size={12} /> {u.openFlags}</Pill>}
                      </div>
                    </td>
                    <td className="p-4 font-bold text-green-600">{formatInr(u.walletBalance)}</td>
                    <td className="p-4 font-bold text-blue-600">{formatCount(u.ecoPoints)}</td>
                    <td className="p-4 text-slate-600">{formatCount(u.impact?.items)}</td>
                    <td className="p-4 text-slate-600">{formatCo2(u.impact?.co2Kg)}</td>
                    <td className="p-4 text-slate-500 text-sm">{formatDate(u.createdAt)}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => setSelected(u.id)} aria-label={t('View {email}', { email: u.email })} className="text-slate-400 hover:text-indigo-600"><ArrowUpRight size={20} /></button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan="8" className="p-8 text-center text-slate-400">{users.length ? t('No users match "{q}"', { q: search }) : t('No users yet.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
            <span className="text-sm text-slate-500">{t('Showing {n} records', { n: filtered.length })}</span>
            <button onClick={exportCsv} disabled={!filtered.length} className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-lg disabled:opacity-40">
              <Download size={16} /> {t('Export CSV')}
            </button>
          </div>
        </>
      )}
      {selected && <UserDrawer userId={selected} onClose={() => setSelected(null)} onChanged={() => { reload(); onChanged?.(); }} />}
    </Panel>
  );
}
