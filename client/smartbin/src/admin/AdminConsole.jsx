import React, { useState } from 'react';
import {
  ShieldCheck, RefreshCw, Gauge, Trash2, Percent, ShieldAlert, Landmark, Users, Leaf, Scale, Store,
  LayoutDashboard, Boxes, Ticket, Coins,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import AppShell from '../layout';
import { useI18n, tk } from '../i18n';
import { formatCo2, formatCount, formatInr, formatKg } from '../format';
import { useAdminData } from './useAdminApi';
import { Stat, Loading, LoadError } from './ui';
import OpsMap from './OpsMap';
import BinsPanel from './BinsPanel';
import FlagsPanel from './FlagsPanel';
import RedemptionsPanel from './RedemptionsPanel';
import UsersPanel from './UsersPanel';
import RewardsPanel from './RewardsPanel';

const TABS = [
  { id: 'overview', label: tk('Overview'), icon: LayoutDashboard },
  { id: 'bins', label: tk('Bins'), icon: Boxes },
  { id: 'flags', label: tk('Fraud flags'), icon: ShieldAlert },
  { id: 'redemptions', label: tk('Redemptions'), icon: Ticket },
  { id: 'users', label: tk('Users'), icon: Users },
  { id: 'rewards', label: tk('Rewards'), icon: Coins },
];

// Operations console: what a campus or municipality runs the fleet from.
export default function AdminConsole() {
  const { t } = useI18n();
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(7);
  const overview = useAdminData('/api/admin/overview');
  const ops = useAdminData('/api/admin/ops', { days });

  const refresh = () => { overview.reload(); ops.reload(); };
  const o = overview.data;
  const totals = ops.data?.totals;

  return (
    <AppShell footer={false}>
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-5 flex justify-between items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-indigo-600 p-2 rounded-lg flex-shrink-0"><ShieldCheck className="text-white w-6 h-6" aria-hidden="true" /></div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-800">{t('Operations console')}</h1>
              <p className="text-xs text-slate-500">{t('Fleet, collections, contamination, fraud and payouts')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="ops-days">{t('Reporting period')}</label>
            <select id="ops-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="p-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700">
              {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{t('Last {n} days', { n: d })}</option>)}
            </select>
            <Link to="/counter" className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100"><Store size={16} /> {t('Counter')}</Link>
            <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:text-indigo-600 hover:bg-slate-100">
              <RefreshCw size={16} aria-hidden="true" /> <span className="hidden sm:inline">{t('Refresh')}</span>
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-8 overflow-x-auto">
          <div role="tablist" aria-label={t('Console sections')} className="flex gap-1">
            {TABS.map(({ id, label, icon }) => {
              const Icon = icon;
              return (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon size={16} aria-hidden="true" /> {t(label)}
                  {id === 'flags' && o?.openFlags > 0 && <span className="ml-1 px-1.5 rounded-full bg-red-600 text-white text-[11px]">{o.openFlags}</span>}
                  {id === 'redemptions' && o?.pendingCount > 0 && <span className="ml-1 px-1.5 rounded-full bg-amber-500 text-white text-[11px]">{o.pendingCount}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
        {tab === 'overview' && (
          <>
            {(overview.status === 'error' || ops.status === 'error') && <LoadError onRetry={refresh} />}
            {(o || totals) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat icon={Gauge} tint="bg-indigo-50 text-indigo-600" label={t('Bins active')}
                  value={totals ? `${totals.active}/${totals.bins}` : '…'} note={totals ? t('{n} at 80%+ full', { n: totals.nearlyFull }) : ''} />
                <Stat icon={Trash2} tint="bg-green-50 text-green-600" label={t('Items · last {n} days', { n: days })}
                  value={totals ? formatCount(totals.items) : '…'}
                  note={totals ? t('{kg} collected · {measured} weighed', { kg: formatKg(totals.weightKg), measured: formatKg(totals.measuredKg) }) : ''} />
                <Stat icon={Percent} tint="bg-amber-50 text-amber-600" label={t('Contamination rate')}
                  value={totals ? (totals.contaminationRate === null ? '—' : `${totals.contaminationRate}%`) : '…'}
                  note={totals ? t('{n} wrong-stream items', { n: totals.wrongStream }) : ''} />
                <Stat icon={ShieldAlert} tint="bg-red-50 text-red-600" label={t('Open fraud flags')}
                  value={o ? formatCount(o.openFlags) : '…'} note={o ? t('{n} high severity · {b} blocked', { n: o.highFlags, b: o.blocked }) : ''} />
                <Stat icon={Users} tint="bg-blue-50 text-blue-600" label={t('Registered users')}
                  value={o ? formatCount(o.users) : '…'} note={o ? t('{a} admin · {v} vendor', { a: o.admins, v: o.vendors }) : ''} />
                <Stat icon={Landmark} tint="bg-indigo-50 text-indigo-600" label={t('Paid out')}
                  value={o ? formatInr(o.paidOut) : '…'} note={o ? t('{amount} pending ({n})', { amount: formatInr(o.pendingAmount), n: o.pendingCount }) : ''} />
                <Stat icon={Leaf} tint="bg-emerald-50 text-emerald-600" label={t('CO₂ saved (est.)')}
                  value={o ? formatCo2(o.co2Kg) : '…'} note={o ? t('{n} items all time', { n: formatCount(o.items) }) : ''} />
                <Stat icon={Scale} tint="bg-yellow-50 text-yellow-600" label={t('Rewards earned')}
                  value={o ? formatInr(o.rewardsIssued) : '…'} note={o ? t('{amount} still in wallets · {n} unused vouchers', { amount: formatInr(o.walletTotal), n: o.openVouchers }) : ''} />
              </div>
            )}
            {ops.status === 'loading' && !ops.data && <Loading />}
            {ops.data && <OpsMap bins={ops.data.bins} depot={ops.data.depot} />}
          </>
        )}

        {tab === 'bins' && (
          ops.data ? <BinsPanel bins={ops.data.bins} days={days} onChanged={refresh} />
            : ops.status === 'error' ? <LoadError onRetry={ops.reload} /> : <Loading />
        )}
        {tab === 'flags' && <FlagsPanel onChanged={refresh} />}
        {tab === 'redemptions' && <RedemptionsPanel onChanged={overview.reload} />}
        {tab === 'users' && <UsersPanel onChanged={overview.reload} />}
        {tab === 'rewards' && <RewardsPanel />}
      </div>
    </AppShell>
  );
}
