import { FILL_PARTIAL, FILL_FULL } from './fill';
import React from 'react';
import { Loader2, RefreshCw, WifiOff, X } from 'lucide-react';
import useDialog from '../useDialog';
import { useI18n } from '../i18n';

export function Panel({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-slate-800">{title}</h2>}
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ icon, tint, label, value, note }) {
  const Icon = icon;
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500 mb-1 truncate">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold text-slate-800 tabular-nums">{value}</p>
        {note && <p className="text-xs text-slate-400 truncate">{note}</p>}
      </div>
      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${tint}`}><Icon size={22} aria-hidden="true" /></div>
    </div>
  );
}

export function Loading({ label }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
      <Loader2 className="animate-spin text-indigo-600" size={32} />
      <p className="font-medium">{label || t('Loading…')}</p>
    </div>
  );
}

export function LoadError({ onRetry }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3 px-4">
      <WifiOff className="text-slate-400" size={36} />
      <p className="font-bold text-slate-800">{t('Could not load this section')}</p>
      <p className="text-sm text-slate-500">{t('The server may be waking up. Please try again.')}</p>
      <button onClick={onRetry} className="mt-2 inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700">
        <RefreshCw size={16} /> {t('Try again')}
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, busy = false, wide = false }) {
  const { t } = useI18n();
  const ref = useDialog(onClose, !busy);
  return (
    <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white outline-none w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl shadow-2xl p-6 relative max-h-[90dvh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} disabled={busy} aria-label={t('Close')} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 disabled:opacity-40">
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold text-slate-800 pr-8 mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Pill({ className = '', children, title }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${className}`}>{children}</span>;
}

export function FillBar({ level, source, inactive = false }) {
  const { t } = useI18n();
  if (inactive) {
    return (
      <div className="min-w-[7rem]">
        <div className="text-xs font-bold text-slate-500 mb-1">{t('Inactive')}</div>
        <div className="h-2 bg-slate-100 rounded-full" />
      </div>
    );
  }
  const color = level >= FILL_FULL ? 'bg-red-500' : level >= FILL_PARTIAL ? 'bg-orange-500' : 'bg-emerald-500';
  return (
    <div className="min-w-[7rem]">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span className="font-bold text-slate-700">{level}%</span>
        <span>{source === 'sensor' ? t('sensor') : source === 'manual' ? t('manual') : t('estimate')}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full`} style={{ width: `${level}%` }} /></div>
    </div>
  );
}

export const inputClass = 'w-full p-2.5 border border-slate-300 bg-white rounded-lg text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none';
export const buttonPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50';
export const buttonGhost = 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50';
export const buttonDanger = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50';
