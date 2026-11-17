import React, { useState } from 'react';
import { Trash2, Settings2, MonitorSmartphone, Loader2, Copy, Check, KeyRound, ExternalLink, ShieldAlert, Gauge } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { STREAMS, streamOf } from '../waste';
import { formatDateTime } from '../format';
import { useAuthErrorHandler } from './useAdminApi';
import { FILL_PARTIAL, FILL_FULL } from './fill';
import { Panel, Modal, Pill, FillBar, inputClass, buttonPrimary, buttonGhost, buttonDanger } from './ui';

const STATUS_STYLE = {
  Active: 'bg-green-100 text-green-700 border-green-200',
  Full: 'bg-red-100 text-red-700 border-red-200',
  Inactive: 'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_TEXT = { Active: tk('Active'), Full: tk('Full'), Inactive: tk('Inactive') };

function useSubmit(onDone) {
  const handleAuthError = useAuthErrorHandler();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, fallback) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      onDone?.(out);
      return out;
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function EmptyBinModal({ bin, onClose, onSaved }) {
  const { t } = useI18n();
  const [weight, setWeight] = useState('');
  const [contamination, setContamination] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useSubmit(() => { onSaved(); onClose(); });

  const submit = (e) => {
    e.preventDefault();
    run(() => api.post(`/api/admin/bins/${encodeURIComponent(bin.id)}/empty`, {
      measuredWeightKg: weight === '' ? null : Number(weight),
      contaminationPct: contamination === '' ? null : Number(contamination),
      notes,
    }), tk('Could not record the collection.'));
  };

  return (
    <Modal title={t('Mark {bin} as emptied', { bin: bin.name })} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500">{t('Resets the fill level and records the collection. Weight and contamination are optional but make the reports real.')}</p>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Weight collected (kg)')}</span>
          <input type="number" min="0" step="0.1" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Contamination seen (% of the bag in the wrong stream)')}</span>
          <input type="number" min="0" max="100" step="1" inputMode="numeric" value={contamination} onChange={(e) => setContamination(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Notes')}</span>
          <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonGhost} disabled={busy}>{t('Cancel')}</button>
          <button type="submit" className={buttonPrimary} disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />} {t('Save collection')}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditBinModal({ bin, onClose, onSaved }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    status: bin.status, stream: bin.stream, qrMode: bin.qrMode, capacityItems: bin.capacityItems || 200, zone: bin.zone || '', fillLevel: '',
  });
  const { busy, error, run } = useSubmit(() => { onSaved(); onClose(); });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const body = { status: form.status, stream: form.stream, qrMode: form.qrMode, capacityItems: Number(form.capacityItems), zone: form.zone };
    if (form.fillLevel !== '') body.fillLevel = Number(form.fillLevel);
    run(() => api.post(`/api/admin/bins/${encodeURIComponent(bin.id)}`, body), tk('Could not save the bin.'));
  };

  return (
    <Modal title={t('Bin settings · {bin}', { bin: bin.name })} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Status')}</span>
          <select value={form.status} onChange={set('status')} className={inputClass}>
            {Object.keys(STATUS_TEXT).map((s) => <option key={s} value={s}>{t(STATUS_TEXT[s])}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Waste stream (BBMP)')}</span>
          <select value={form.stream} onChange={set('stream')} className={inputClass}>
            {['station', 'dry', 'wet', 'reject'].map((s) => <option key={s} value={s}>{t(STREAMS[s].label)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('QR mode')}</span>
          <select value={form.qrMode} onChange={set('qrMode')} className={inputClass}>
            <option value="static">{t('Printed signed QR')}</option>
            <option value="dynamic">{t('Live rotating QR on a screen')}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Capacity (items)')}</span>
          <input type="number" min="1" step="1" value={form.capacityItems} onChange={set('capacityItems')} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Zone / block')}</span>
          <input type="text" maxLength={60} value={form.zone} onChange={set('zone')} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{t('Set fill level now (%)')}</span>
          <input type="number" min="0" max="100" step="1" value={form.fillLevel} onChange={set('fillLevel')} placeholder={`${bin.fill.level}`} className={inputClass} />
        </label>
        {form.qrMode === 'dynamic' && bin.qrMode !== 'dynamic' && (
          <p className="sm:col-span-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">{t('Set up the bin screen first: once live mode is on, the printed QR on this bin stops working.')}</p>
        )}
        {error && <p role="alert" className="sm:col-span-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonGhost} disabled={busy}>{t('Cancel')}</button>
          <button type="submit" className={buttonPrimary} disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />} {t('Save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function ScreenSetupModal({ bin, onClose, onSaved }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const { busy, error: rotateError, run } = useSubmit(() => { setDevice(null); setConfirmRotate(false); onSaved(); });

  React.useEffect(() => {
    if (device) return;
    api.get(`/api/admin/bins/${encodeURIComponent(bin.id)}/device`)
      .then((res) => setDevice(res.data))
      .catch((err) => { if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not load the device key.'))); });
  }, [bin.id, device, handleAuthError]);

  const url = device ? `${window.location.origin}/bin-display#bin=${encodeURIComponent(device.binId)}&v=${device.keyVersion}&key=${encodeURIComponent(device.deviceKey)}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select manually */ }
  };

  return (
    <Modal title={t('Bin screen setup · {bin}', { bin: bin.name })} onClose={onClose} busy={busy} wide>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">{t('Open this link once on the tablet or kiosk mounted on the bin and keep it in full screen. It shows a QR code that changes every {n} seconds, so photos and shared screenshots of the code stop working.', { n: device?.period || 30 })}</p>
        <ol className="list-decimal pl-5 text-slate-600 space-y-1">
          <li>{t('Open the link on the bin\'s screen (keep it private — it contains the bin\'s key).')}</li>
          <li>{t('Check the code is showing, then switch this bin\'s QR mode to "Live rotating QR".')}</li>
          <li>{t('Fill-level sensors and scales use the same key with the device API (see the README).')}</li>
        </ol>
        {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        {!device && !error && <p className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" /> {t('Loading…')}</p>}
        {device && (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-xs break-all text-slate-700">{url}</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className={buttonPrimary}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('Copied') : t('Copy link')}</button>
              <a href={url} target="_blank" rel="noopener noreferrer" className={buttonGhost}><ExternalLink size={16} /> {t('Preview')}</a>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="font-semibold text-slate-800 flex items-center gap-2"><KeyRound size={16} aria-hidden="true" /> {t('Key version {v}', { v: device.keyVersion })}</p>
              <p className="text-slate-500 mt-1">{t('Replace the key if the screen is lost or tampered with. The old screen and its codes stop working immediately.')}</p>
              {rotateError && <p role="alert" className="mt-2 text-red-600 bg-red-50 rounded-lg p-3">{rotateError}</p>}
              {confirmRotate ? (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => run(() => api.post(`/api/admin/bins/${encodeURIComponent(bin.id)}/rotate-key`), tk('Could not replace the key.'))} disabled={busy} className={buttonDanger}>
                    {busy && <Loader2 size={16} className="animate-spin" />} {t('Yes, replace the key')}
                  </button>
                  <button onClick={() => setConfirmRotate(false)} className={buttonGhost} disabled={busy}>{t('Cancel')}</button>
                </div>
              ) : (
                <button onClick={() => setConfirmRotate(true)} className={`${buttonGhost} mt-3 text-red-600`}>{t('Replace key')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// One-click fill marking: partly full keeps the bin open, full closes it to deposits until emptied.
const MARKS = {
  partial: { body: { status: 'Active', fillLevel: 60 }, label: tk('Partly full'), className: 'text-orange-600' },
  full: { body: { status: 'Full', fillLevel: 100 }, label: tk('Full'), className: 'text-red-600' },
};

function MarkButtons({ bin, onChanged }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(null);
  const { error, run } = useSubmit(onChanged);
  const mark = async (kind) => {
    setPending(kind);
    await run(() => api.post(`/api/admin/bins/${encodeURIComponent(bin.id)}`, MARKS[kind].body), tk('Could not save the bin.'));
    setPending(null);
  };
  if (bin.status === 'Inactive') return null;
  return (
    <>
      {Object.entries(MARKS).map(([kind, m]) => {
        const current = kind === 'full' ? bin.status === 'Full' : bin.status !== 'Full' && bin.fill.level >= FILL_PARTIAL && bin.fill.level < FILL_FULL;
        return (
          <button key={kind} onClick={() => mark(kind)} disabled={!!pending || current} className={`${buttonGhost} ${m.className} disabled:opacity-40`} title={t('Mark as {state}', { state: t(m.label) })}>
            {pending === kind ? <Loader2 size={16} className="animate-spin" /> : <Gauge size={16} />} <span className="hidden lg:inline">{t(m.label)}</span>
          </button>
        );
      })}
      {error && <span role="alert" className="basis-full text-right text-xs text-red-600">{error}</span>}
    </>
  );
}

export default function BinsPanel({ bins, days, onChanged }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState(null); // { kind: 'empty'|'edit'|'screen', bin }
  const sorted = [...bins].sort((a, b) => b.fill.level - a.fill.level || String(a.name).localeCompare(String(b.name)));
  const close = () => setDialog(null);

  return (
    <Panel title={t('Bins')} subtitle={t('Fill level, contamination and activity for the last {n} days. Fullest first.', { n: days })}>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
            <tr>
              <th className="p-4">{t('Bin')}</th>
              <th className="p-4">{t('Fill')}</th>
              <th className="p-4">{t('Items')}</th>
              <th className="p-4">{t('Contamination')}</th>
              <th className="p-4">{t('Last emptied')}</th>
              <th className="p-4 text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((b) => {
              const stream = streamOf(b.stream);
              return (
                <tr key={b.id} className="hover:bg-slate-50 align-top">
                  <td className="p-4">
                    <p className="font-bold text-slate-800">{b.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Pill className={STATUS_STYLE[b.status] || STATUS_STYLE.Inactive}>{t(STATUS_TEXT[b.status] || b.status)}</Pill>
                      <Pill className="bg-white border-slate-200 text-slate-600"><span className="w-2 h-2 rounded-full" style={{ background: stream.color }} />{t(stream.label)}</Pill>
                      {b.qrMode === 'dynamic' && <Pill className="bg-indigo-50 text-indigo-700 border-indigo-200">{t('Live QR')}</Pill>}
                      {b.openFlags > 0 && <Pill className="bg-red-50 text-red-700 border-red-200"><ShieldAlert size={12} /> {b.openFlags}</Pill>}
                    </div>
                    {b.zone && <p className="text-xs text-slate-400 mt-1">{b.zone}</p>}
                  </td>
                  <td className="p-4"><FillBar level={b.fill.level} source={b.fill.source} inactive={b.status === 'Inactive'} /></td>
                  <td className="p-4 text-slate-600">
                    <p className="font-bold text-slate-800">{b.items}</p>
                    <p className="text-xs">{t('{kg} kg', { kg: b.weightKg })}{b.measuredKg ? ` · ${t('{kg} kg weighed', { kg: b.measuredKg })}` : ''}</p>
                    <p className="text-xs">{t('{n} users', { n: b.activeUsers })}</p>
                  </td>
                  <td className="p-4 text-slate-600">
                    <p className={`font-bold ${b.contaminationRate >= 20 ? 'text-red-600' : b.contaminationRate >= 10 ? 'text-amber-700' : 'text-slate-800'}`}>
                      {b.contaminationRate === null ? '—' : `${b.contaminationRate}%`}
                    </p>
                    <p className="text-xs">{t('{n} wrong-stream items', { n: b.wrongStream })}</p>
                    {b.auditedContamination && <p className="text-xs">{t('Audit: {pct}%', { pct: b.auditedContamination.pct })}</p>}
                  </td>
                  <td className="p-4 text-xs text-slate-500">{b.lastEmptiedAt ? formatDateTime(b.lastEmptiedAt) : '—'}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1 flex-wrap">
                      <MarkButtons bin={b} onChanged={onChanged} />
                      <button onClick={() => setDialog({ kind: 'empty', bin: b })} className={buttonGhost} title={t('Mark emptied')}><Trash2 size={16} /> <span className="hidden lg:inline">{t('Emptied')}</span></button>
                      <button onClick={() => setDialog({ kind: 'edit', bin: b })} className={buttonGhost} title={t('Settings')} aria-label={t('Settings')}><Settings2 size={16} /></button>
                      <button onClick={() => setDialog({ kind: 'screen', bin: b })} className={buttonGhost} title={t('Bin screen setup')} aria-label={t('Bin screen setup')}><MonitorSmartphone size={16} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!sorted.length && <tr><td colSpan="6" className="p-8 text-center text-slate-400">{t('No bins registered yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'empty' && <EmptyBinModal bin={dialog.bin} onClose={close} onSaved={onChanged} />}
      {dialog?.kind === 'edit' && <EditBinModal bin={dialog.bin} onClose={close} onSaved={onChanged} />}
      {dialog?.kind === 'screen' && <ScreenSetupModal bin={dialog.bin} onClose={close} onSaved={onChanged} />}
    </Panel>
  );
}
