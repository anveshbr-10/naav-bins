import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { WASTE_BY_NAME, streamOf } from '../waste';
import { formatDateTime } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, buttonPrimary, inputClass } from './ui';

// One editable row. Saves to the database; the API and every app pick it up within a minute.
function Row({ cells, initial, onSave }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(form);
      setMsg({ ok: true, text: t('Saved') });
    } catch (err) {
      if (!handleAuthError(err)) setMsg({ ok: false, text: apiErrorMessage(err, tk('Could not save.')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="align-middle">
      {cells(form, setForm)}
      <td className="p-3 text-right whitespace-nowrap">
        <button onClick={save} disabled={!dirty || busy} className={buttonPrimary} aria-label={t('Save')}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} aria-hidden="true" />}
        </button>
        {msg && <p className={`text-xs mt-1 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </td>
    </tr>
  );
}

const num = 'w-24 p-2 border border-slate-300 bg-white rounded-lg text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none';

// Campus wallet + delayed cashback settings (reward_program, one row).
function ProgramPanel() {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const { status, data, reload } = useAdminData('/api/admin/program');
  const p = data?.program;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const f = form || (p && {
    active: p.active, pointsPerRupee: p.pointsPerRupee, instantPct: p.instantPct,
    milestones: p.milestones.join(', '), multiplierMin: p.multiplierMin, multiplierMax: p.multiplierMax,
    dailyBonusBudget: p.dailyBonusBudget, expiryDays: p.expiryDays,
  });
  const set = (k) => (e) => setForm({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const rate = Number(f.pointsPerRupee);
    const rateChanged = rate !== p.pointsPerRupee;
    if (rateChanged && !window.confirm(t("Change the rate from {from} to {to} points per ₹1? This changes what every student's unredeemed points are worth, and is recorded.", { from: p.pointsPerRupee, to: rate }))) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/admin/program', {
        confirmRateChange: rateChanged,
        active: f.active, pointsPerRupee: Number(f.pointsPerRupee), instantPct: Number(f.instantPct),
        milestones: String(f.milestones).split(/[,\s]+/).filter(Boolean).map(Number),
        multiplierMin: Number(f.multiplierMin), multiplierMax: Number(f.multiplierMax),
        dailyBonusBudget: Number(f.dailyBonusBudget), expiryDays: Number(f.expiryDays),
      });
      setForm(null);
      reload();
      setMsg({ ok: true, text: t('Saved') });
    } catch (err) {
      if (!handleAuthError(err)) setMsg({ ok: false, text: apiErrorMessage(err, tk('Could not save.')) });
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{t(label)}</span>
      <input className={inputClass} value={f[key]} onChange={set(key)} required {...props} />
    </label>
  );

  return (
    <Panel title={t('Campus wallet & cashback')} subtitle={t('Points are the campus wallet. Part of each item is paid at once; the rest is a bonus released at milestones with a random multiplier.')}>
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {p && f && (
        <form onSubmit={save} className="p-4 space-y-4 text-sm">
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2"><input type="checkbox" className="w-5 h-5 accent-indigo-600" checked={f.active} onChange={set('active')} /> <span className="font-semibold text-slate-700">{t('Delayed cashback on')}</span></label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('pointsPerRupee', tk('Points per ₹1'), { type: 'number', min: 1, max: 1000, step: 1 })}
            {field('instantPct', tk('Paid at once (%)'), { type: 'number', min: 0, max: 100, step: 1 })}
            {field('milestones', tk('Milestones (items)'), { placeholder: '5, 10, 20' })}
            {field('expiryDays', tk('Bonus expires after (days idle)'), { type: 'number', min: 1, max: 365, step: 1 })}
            {field('multiplierMin', tk('Multiplier min'), { type: 'number', min: 1, max: 3, step: 0.01 })}
            {field('multiplierMax', tk('Multiplier max'), { type: 'number', min: 1, max: 3, step: 0.01 })}
            {field('dailyBonusBudget', tk('Daily bonus budget (pts)'), { type: 'number', min: 0, step: 1 })}
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-500">{t('Bonus given today')}</p>
              <p className="font-bold text-slate-800">{t('{n} pts', { n: data.bonusToday })}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !form} className={buttonPrimary}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} aria-hidden="true" />} {t('Save')}</button>
            {msg && <p className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
          </div>
          {data.history?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">{t('Recent changes')}</p>
              <ul className="text-xs text-slate-600 divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {data.history.map((h) => (
                  <li key={h.changed_at} className="px-3 py-2 flex flex-wrap gap-x-3">
                    <span className="text-slate-400">{formatDateTime(h.changed_at)}</span>
                    <span>{h.changed_by || '—'}</span>
                    {h.rate_before !== h.rate_after
                      ? <span className="font-semibold text-amber-700">{t('Rate {from} → {to} points per ₹1', { from: h.rate_before, to: h.rate_after })}</span>
                      : <span>{t('Settings changed')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </Panel>
  );
}

export default function RewardsPanel() {
  const { t } = useI18n();
  const { status, data, reload } = useAdminData('/api/admin/rewards');

  return (
    <div className="space-y-6">
      <ProgramPanel />
      <Panel title={t('Reward table')} subtitle={t('Per-item reward for each material. Stored in the database: changes apply to new deposits within a minute, no deploy needed.')}>
        {status === 'loading' && !data && <Loading />}
        {status === 'error' && <LoadError onRetry={reload} />}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
                <tr><th className="p-3">{t('Material')}</th><th className="p-3">{t('Stream')}</th><th className="p-3">₹</th><th className="p-3">{t('Points')}</th><th className="p-3">{t('Active')}</th><th className="p-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rules.map((r) => (
                  <Row
                    key={`${r.waste_type}-${r.updated_at}`}
                    initial={{ reward: r.reward_inr, points: r.points, active: r.active }}
                    onSave={(f) => api.post('/api/admin/rewards/rule', { wasteType: r.waste_type, rewardInr: Number(f.reward), points: Number(f.points), active: f.active })}
                    cells={(f, set) => (
                      <>
                        <td className="p-3 font-semibold text-slate-800">{WASTE_BY_NAME[r.waste_type]?.emoji} {t(WASTE_BY_NAME[r.waste_type]?.label || r.waste_type)}</td>
                        <td className="p-3 text-slate-600">{t(streamOf(r.stream).label)}</td>
                        <td className="p-3"><input type="number" min="0" className={num} value={f.reward} onChange={(e) => set({ ...f, reward: e.target.value })} aria-label={t('Reward (₹)')} /></td>
                        <td className="p-3"><input type="number" min="0" className={num} value={f.points} onChange={(e) => set({ ...f, points: e.target.value })} aria-label={t('Points')} /></td>
                        <td className="p-3"><input type="checkbox" className="w-5 h-5 accent-indigo-600" checked={f.active} onChange={(e) => set({ ...f, active: e.target.checked })} aria-label={t('Active')} /></td>
                      </>
                    )}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

