import React, { useState } from 'react';
import { ShieldAlert, Loader2, Check, Ban, X } from 'lucide-react';
import api, { apiErrorMessage } from '../api';
import { useI18n, tk } from '../i18n';
import { formatDateTime } from '../format';
import { useAdminData, useAuthErrorHandler } from './useAdminApi';
import { Panel, Loading, LoadError, Pill, buttonGhost } from './ui';
import { FLAG_INFO } from './flagInfo';

const SEVERITY = {
  high: { cls: 'bg-red-100 text-red-700 border-red-200', label: tk('High') },
  medium: { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: tk('Medium') },
  low: { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: tk('Low') },
};

function detailsText(f, t) {
  const d = f.details || {};
  if (f.kind === 'geofence' && d.distance !== undefined) return t('{d} m from the bin', { d: d.distance });
  if (f.kind === 'duplicate_photo' && d.distance !== undefined) return t('{bits} of 64 bits different', { bits: d.distance }) + (d.matchedUser && d.matchedUser !== f.user_id ? ` · ${t('matched another user\'s photo')}` : '');
  if (f.kind === 'weight_mismatch') return t('{measured} kg measured, ~{expected} kg expected', { measured: d.measuredKg, expected: d.expectedKg });
  if (f.kind === 'daily_cap') return t('Limit {n} items', { n: d.limit });
  return '';
}

export default function FlagsPanel({ onChanged }) {
  const { t } = useI18n();
  const handleAuthError = useAuthErrorHandler();
  const [scope, setScope] = useState('open');
  const { status, data, reload } = useAdminData('/api/admin/flags', { scope });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const resolve = async (flag, resolution, blockUser = false) => {
    setBusy(flag.id);
    setError(null);
    try {
      await api.post(`/api/admin/flags/${flag.id}/resolve`, { resolution, blockUser });
      reload();
      onChanged?.();
    } catch (err) {
      if (!handleAuthError(err)) setError(apiErrorMessage(err, tk('Could not update the flag.')));
    } finally {
      setBusy(null);
    }
  };

  const flags = data?.flags || [];
  return (
    <Panel
      title={t('Fraud flags')}
      subtitle={t('Raised automatically by the QR, geofence, photo and rate-limit checks. Confirm to keep a record, or block the account.')}
      actions={
        <div role="group" aria-label={t('Show')} className="inline-flex rounded-lg bg-slate-100 p-1">
          {[['open', tk('Open')], ['all', tk('All')]].map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)} aria-pressed={scope === id}
              className={`px-3 py-1.5 rounded-md text-xs font-bold ${scope === id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}>{t(label)}</button>
          ))}
        </div>
      }
    >
      {error && <p role="alert" className="m-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
      {status === 'loading' && !data && <Loading />}
      {status === 'error' && <LoadError onRetry={reload} />}
      {data && (flags.length === 0 ? (
        <p className="p-8 text-center text-slate-400">{scope === 'open' ? t('No open flags. 🎉') : t('No flags yet.')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {flags.map((f) => {
            const info = FLAG_INFO[f.kind] || { title: f.kind, hint: '' };
            const sev = SEVERITY[f.severity] || SEVERITY.medium;
            return (
              <li key={f.id} className="p-4 md:px-6 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <ShieldAlert className={`flex-shrink-0 mt-0.5 ${f.severity === 'high' ? 'text-red-600' : f.severity === 'low' ? 'text-slate-400' : 'text-amber-600'}`} size={20} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 flex flex-wrap items-center gap-2">
                      {t(info.title)} <Pill className={sev.cls}>{t(sev.label)}</Pill>
                      {f.resolution && <Pill className="bg-slate-100 text-slate-600 border-slate-200">{f.resolution === 'confirmed' ? t('Confirmed') : t('Dismissed')}</Pill>}
                      {f.userBlocked && <Pill className="bg-red-50 text-red-700 border-red-200">{t('Blocked')}</Pill>}
                    </p>
                    <p className="text-xs text-slate-500">{t(info.hint)} {detailsText(f, t)}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {f.userName || f.userEmail || t('Unknown user')}{f.userEmail ? ` · ${f.userEmail}` : ''}{f.bin_id ? ` · ${t('Bin {id}', { id: f.bin_id })}` : ''} · {formatDateTime(f.created_at)}
                    </p>
                  </div>
                </div>
                {!f.resolved_at && (
                  <div className="flex items-center gap-1 flex-wrap justify-end flex-shrink-0">
                    {busy === f.id && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    <button onClick={() => resolve(f, 'dismissed')} disabled={busy === f.id} className={buttonGhost}><X size={14} /> {t('Dismiss')}</button>
                    <button onClick={() => resolve(f, 'confirmed')} disabled={busy === f.id} className={buttonGhost}><Check size={14} /> {t('Confirm')}</button>
                    {f.user_id && !f.userBlocked && (
                      <button onClick={() => resolve(f, 'confirmed', true)} disabled={busy === f.id} className={`${buttonGhost} text-red-600`}><Ban size={14} /> {t('Confirm & block')}</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </Panel>
  );
}
