import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { WASTE_BY_NAME, streamOf } from '../waste';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, buttonPrimary } from './ui';

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

export default function RewardsPanel() {
  const { t } = useI18n();
  const { status, data, reload } = useAdminData('/api/admin/rewards');

  return (
    <div className="space-y-6">
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

      <Panel title={t('Campus credits catalogue')} subtitle={t('What Eco Points can be exchanged for. Add new items or vendors in the reward_catalog table.')}>
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
                <tr><th className="p-3">{t('Item')}</th><th className="p-3">{t('Claimed at')}</th><th className="p-3">{t('Cost')}</th><th className="p-3">{t('Active')}</th><th className="p-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.catalog.map((c) => (
                  <Row
                    key={`${c.item}-${c.updated_at}`}
                    initial={{ cost: c.cost, active: c.active }}
                    onSave={(f) => api.post('/api/admin/rewards/item', { item: c.item, cost: Number(f.cost), active: f.active })}
                    cells={(f, set) => (
                      <>
                        <td className="p-3"><p className="font-semibold text-slate-800">{c.item}</p><p className="text-xs text-slate-500">{c.description}</p></td>
                        <td className="p-3 text-slate-600">{c.type === 'money' ? t('UPI payout') : c.vendor || '—'}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {c.type === 'money' && <span className="text-slate-500">₹</span>}
                            <input type="number" min="1" className={num} value={f.cost} onChange={(e) => set({ ...f, cost: e.target.value })} aria-label={t('Cost')} />
                            {c.type === 'points' && <span className="text-slate-500 text-xs">{t('pts')}</span>}
                          </div>
                        </td>
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

