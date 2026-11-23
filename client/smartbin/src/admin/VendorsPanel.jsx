import React, { useState } from 'react';
import { Plus, Pencil, Download, Store, MapPin, Users, Ticket, Loader2 } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk, localized } from '../i18n';
import { formatCount, formatInr } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, Modal, Pill, inputClass, buttonPrimary, buttonGhost } from './ui';

const VENDOR_CATEGORIES = [
  { id: 'canteen', label: tk('Canteen') },
  { id: 'snacks', label: tk('Snack stall') },
  { id: 'stationery', label: tk('Stationery') },
  { id: 'print', label: tk('Xerox / print') },
  { id: 'other', label: tk('Other') },
];
const CATEGORY_LABEL = Object.fromEntries(VENDOR_CATEGORIES.map((c) => [c.id, c.label]));

// CSV cell: quote everything and neutralise spreadsheet formulas (CSV injection).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function VendorForm({ vendor, walletReady, onClose, onSaved }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const isNew = !vendor;
  const [form, setForm] = useState({
    id: vendor?.id || '',
    name: vendor?.name || '',
    category: vendor?.category || 'canteen',
    location: vendor?.location || '',
    dailyClaimLimit: vendor?.daily_claim_limit ?? 300,
    maxTxnInr: vendor?.max_txn_inr ?? 500,
    dailyLimitInr: vendor?.daily_limit_inr ?? 20000,
    active: vendor?.active ?? true,
    kn: (vendor?.labels && typeof vendor.labels.kn === 'string' && vendor.labels.kn) || '',
    hi: (vendor?.labels && typeof vendor.labels.hi === 'string' && vendor.labels.hi) || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name, category: form.category, location: form.location,
      dailyClaimLimit: Number(form.dailyClaimLimit), active: form.active, labels: { kn: form.kn, hi: form.hi },
      // Payment limits exist once 004_wallet_cashback.sql has been run.
      ...(walletReady ? { maxTxnInr: Number(form.maxTxnInr), dailyLimitInr: Number(form.dailyLimitInr) } : {}),
    };
    try {
      if (isNew) await api.post('/api/admin/vendors', { id: form.id, ...body });
      else await api.post(`/api/admin/vendors/${vendor.id}`, body);
      onSaved();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not save.')));
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? t('Add a counter') : t('Edit {name}', { name: vendor.name })} onClose={onClose} busy={busy}>
      <form onSubmit={save} className="space-y-3 text-sm">
        {isNew && (
          <label className="block">
            <span className="font-semibold text-slate-700">{t('Vendor ID')}</span>
            <input className={inputClass} value={form.id} onChange={set('id')} placeholder="night-canteen" required pattern="[a-z0-9\-]{2,40}" />
            <span className="text-xs text-slate-500">{t('Lowercase letters, numbers and dashes. Cannot be changed later.')}</span>
          </label>
        )}
        <label className="block">
          <span className="font-semibold text-slate-700">{t('Name')}</span>
          <input className={inputClass} value={form.name} onChange={set('name')} required minLength={2} maxLength={80} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-semibold text-slate-700">{t('Name in Kannada')}</span>
            <input className={inputClass} value={form.kn} onChange={set('kn')} maxLength={80} />
          </label>
          <label className="block">
            <span className="font-semibold text-slate-700">{t('Name in Hindi')}</span>
            <input className={inputClass} value={form.hi} onChange={set('hi')} maxLength={80} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-semibold text-slate-700">{t('Category')}</span>
            <select className={inputClass} value={form.category} onChange={set('category')}>
              {VENDOR_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold text-slate-700">{t('Daily voucher limit')}</span>
            <input type="number" min="1" max="10000" step="1" className={inputClass} value={form.dailyClaimLimit} onChange={set('dailyClaimLimit')} required />
          </label>
        </div>
        {walletReady && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-semibold text-slate-700">{t('Max per payment (₹)')}</span>
              <input type="number" min="1" max="100000" step="1" className={inputClass} value={form.maxTxnInr} onChange={set('maxTxnInr')} required />
            </label>
            <label className="block">
              <span className="font-semibold text-slate-700">{t('Daily payment limit (₹)')}</span>
              <input type="number" min="1" max="10000000" step="1" className={inputClass} value={form.dailyLimitInr} onChange={set('dailyLimitInr')} required />
            </label>
          </div>
        )}
        <label className="block">
          <span className="font-semibold text-slate-700">{t('Location')}</span>
          <input className={inputClass} value={form.location} onChange={set('location')} maxLength={120} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="w-5 h-5 accent-indigo-600" checked={form.active} onChange={set('active')} />
          <span className="font-semibold text-slate-700">{t('Counter is open (staff can claim vouchers, students can redeem its credits)')}</span>
        </label>
        {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className={buttonGhost}>{t('Cancel')}</button>
          <button type="submit" disabled={busy} className={buttonPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} {t('Save')}</button>
        </div>
      </form>
    </Modal>
  );
}

// Campus counters: who works there, what they handed out, and what the college owes them.
export default function VendorsPanel({ days }) {
  const { t, lang } = useI18n();
  const { status, data, reload } = useAdminData('/api/admin/vendors', { days });
  const [editing, setEditing] = useState(null); // vendor row, 'new', or null

  const vendors = data?.vendors || [];
  const walletReady = vendors.some((v) => v.max_txn_inr !== undefined);

  const exportCsv = () => {
    const header = ['Vendor ID', 'Name', 'Category', 'Active', `Payments (last ${data.days} days)`, 'Payments (INR)',
      'Vouchers claimed', 'Voucher points', 'Voucher value (INR)', 'Total owed (INR)', 'Open vouchers', 'Staff'];
    const rows = vendors.map((v) => [
      v.id, v.name, v.category, v.active ? 'yes' : 'no', v.settlement?.payments ?? 0, v.settlement?.paymentsInr ?? 0,
      v.settlement?.claimed ?? 0, v.settlement?.points ?? 0, v.settlement?.voucherInr ?? 0, v.settlement?.valueInr ?? 0,
      v.openVouchers, v.staff.map((s) => s.email).join('; '),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `naav-bins-vendor-settlement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title={t('Vendors')}
      subtitle={data
        ? t('Campus counters, their staff and settlement for the last {n} days ({rate} points = ₹1).', { n: data.days, rate: data.pointsPerRupee })
        : t('Campus counters, their staff and settlement.')}
      actions={
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!vendors.length} className={buttonGhost}><Download size={16} /> {t('Export CSV')}</button>
          <button onClick={() => setEditing('new')} className={buttonPrimary}><Plus size={16} /> {t('Add a counter')}</button>
        </div>
      }
    >
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {data && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {vendors.map((v) => (
            <div key={v.id} className={`border rounded-2xl p-5 ${v.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-80'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 flex items-center gap-2"><Store size={16} aria-hidden="true" /> {localized(v, 'name', lang)}</p>
                  <p className="text-xs text-slate-500 font-mono">{v.id}</p>
                  {v.location && <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {v.location}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill className={v.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-600 border-slate-200'}>{v.active ? t('Open') : t('Switched off')}</Pill>
                  <Pill className="bg-indigo-50 text-indigo-700 border-indigo-200">{t(CATEGORY_LABEL[v.category] || v.category)}</Pill>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="bg-slate-50 rounded-xl p-2">
                  <p className="text-[11px] text-slate-500">{t('Payments')}</p>
                  <p className="font-bold text-slate-800">{formatCount(v.settlement?.payments)}</p>
                  <p className="text-[10px] text-slate-400">{t('+{n} vouchers', { n: v.settlement?.claimed ?? 0 })}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2">
                  <p className="text-[11px] text-slate-500">{t('Owed to vendor')}</p>
                  <p className="font-bold text-green-700">{formatInr(v.settlement?.valueInr)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2">
                  <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1"><Ticket size={11} /> {t('Unused')}</p>
                  <p className="font-bold text-slate-800">{formatCount(v.openVouchers)}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-600 flex items-center gap-1 mb-1"><Users size={12} /> {t('Counter staff')} · {t('limit {n}/day', { n: v.daily_claim_limit })}{v.max_txn_inr !== undefined ? ` · ${t('max ₹{n}/payment', { n: v.max_txn_inr })}` : ''}</p>
                {v.staff.length === 0
                  ? <p className="text-xs text-slate-400">{t('No staff yet. Give access from Users → a user → Give counter access.')}</p>
                  : <ul className="text-xs text-slate-600 space-y-0.5">{v.staff.map((s) => <li key={s.id} className="truncate">{s.name || '—'} · {s.email}</li>)}</ul>}
              </div>

              <div className="mt-4 flex justify-end">
                <button onClick={() => setEditing(v)} className={buttonGhost}><Pencil size={14} /> {t('Edit')}</button>
              </div>
            </div>
          ))}
          {!vendors.length && <p className="text-sm text-slate-400 p-4">{t('No counters yet. Run server/supabase/003_vendors.sql or add one.')}</p>}
        </div>
      )}
      {editing && (
        <VendorForm
          vendor={editing === 'new' ? null : editing}
          walletReady={walletReady}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </Panel>
  );
}
