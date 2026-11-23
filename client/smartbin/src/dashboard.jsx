import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiErrorMessage, apiStatus } from './api';
import { useAuth } from './authContext';
import { useI18n, localized, tk } from './i18n';
import RedeemModal from './redeemModal';
import PayModal from './payModal';
import ConvertModal from './convertModal';
import WalletHistory from './walletHistory';
import { formatCo2, formatDate, formatDateTime, formatKg } from './format';
import AppShell from './layout';
import { useTheme } from './themeContext';
import { WASTE_TYPES, WASTE_BY_NAME, STREAMS, streamOf, STATUS_LABEL } from './waste';
import { StreakAndRank, Challenges, Badges } from './progress';
import {
  Wallet, Leaf, LogOut, History, Ticket, MapPin, ScanQrCode, Gift, Receipt, RefreshCw, Loader2, TreePine,
  WifiOff, Map as MapIcon, Coffee, PenTool, Printer, Users, Scale, AlertTriangle, Store, Sparkles, ArrowRight,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

// Visual style per redeemable campus credit (amounts and text come from the server catalogue).
function itemStyle(item) {
  if (/canteen/i.test(item)) return { Icon: Coffee, bg: 'bg-amber-100', fg: 'text-amber-700' };
  if (/stationery/i.test(item)) return { Icon: PenTool, bg: 'bg-indigo-100', fg: 'text-indigo-600' };
  if (/print/i.test(item)) return { Icon: Printer, bg: 'bg-blue-100', fg: 'text-blue-600' };
  return { Icon: Gift, bg: 'bg-emerald-100', fg: 'text-emerald-600' };
}

const STATUS_STYLE = {
  Issued: 'bg-green-100 text-green-700 border-green-200',
  Pending: 'bg-amber-100 text-amber-700 border-amber-200',
  Paid: 'bg-blue-100 text-blue-700 border-blue-200',
  Claimed: 'bg-gray-100 text-gray-600 border-gray-200',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
  Cancelled: 'bg-red-100 text-red-700 border-red-200',
};

// Department + hostel, for campus leagues. Shown until both are chosen.
function TeamSetup({ user, onSaved }) {
  const { t, lang } = useI18n();
  const [groups, setGroups] = useState(null);
  const [department, setDepartment] = useState(user.department || '');
  const [hostel, setHostel] = useState(user.hostel || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/campus-groups').then((res) => setGroups(res.data.groups || [])).catch(() => setGroups([]));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/me/profile', { department: department || null, hostel: hostel || null });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, tk('Could not save. Please try again.')));
    } finally {
      setSaving(false);
    }
  };

  const options = (kind) => (groups || []).filter((g) => g.kind === kind);
  const select = 'w-full p-3 rounded-xl border border-gray-300 bg-white text-gray-800 focus:ring-2 focus:ring-green-500 outline-none';
  return (
    <form onSubmit={save} className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-2xl p-5 sm:p-6 mb-8">
      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Users size={20} className="text-green-700" aria-hidden="true" /> {t('Join your campus team')}</h2>
      <p className="text-sm text-gray-600 mt-1 mb-4">{t('Pick your department and hostel. Every item you recycle also scores for them in the weekly leagues.')}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">{t('Department')}</span>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={select} disabled={!groups || saving}>
            <option value="">{t('Choose…')}</option>
            {options('department').map((g) => <option key={g.id} value={g.id}>{localized(g, 'name', lang)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">{t('Hostel')}</span>
          <select value={hostel} onChange={(e) => setHostel(e.target.value)} className={select} disabled={!groups || saving}>
            <option value="">{t('Choose…')}</option>
            {options('hostel').map((g) => <option key={g.id} value={g.id}>{localized(g, 'name', lang)}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={saving || (!department && !hostel)} className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} {t('Save')}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error | missing
  const [loadError, setLoadError] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [redeemEntry, setRedeemEntry] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [walletKey, setWalletKey] = useState(0);

  const { signOut, reloadProfile } = useAuth();
  const { resolved: theme } = useTheme();
  const chart = theme === 'dark'
    ? { grid: '#24312c', axis: '#93a39d', tooltip: { background: '#141d1a', border: '1px solid #31423b', borderRadius: 12, color: '#e9f0ed' } }
    : { grid: '#eef2f0', axis: '#66756f', tooltip: { background: '#ffffff', border: '1px solid #e8eeeb', borderRadius: 12, color: '#111a16' } };
  const goToLogin = useCallback(async () => { await signOut(); navigate('/login', { replace: true }); }, [signOut, navigate]);

  // Only an authentication failure logs the user out; network/server errors show a retry screen.
  const fetchUserData = useCallback(() => api.get('/api/dashboard')
    .then((res) => {
      setData(res.data);
      setLoadState('ready');
    })
    .catch((err) => {
      const code = apiStatus(err);
      if (code === 401) { goToLogin(); return; }
      if (code === 404) { setLoadState('missing'); return; }
      setLoadError(apiErrorMessage(err, tk('Could not load your dashboard.')));
      setLoadState('error');
    }), [goToLogin]);

  const fetchCatalog = useCallback(() => api.get('/api/rewards/catalog')
    .then((res) => {
      setCatalog({ rewards: res.data.rewards || [], redeem: res.data.redeem || [] });
      setCatalogFailed(false);
    })
    .catch(() => setCatalogFailed(true)), []);

  useEffect(() => { fetchUserData(); }, [fetchUserData]);
  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  // Most dashboard visits end with a scan: fetch the scanner code (incl. the AI runtime) while the
  // page is idle, so "Scan a bin" opens instantly. Skipped when the user has asked to save data.
  useEffect(() => {
    if (navigator.connection?.saveData) return undefined;
    const prefetch = () => { import('./scanner').catch(() => { /* loaded on demand instead */ }); };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(prefetch, 2000);
    return () => clearTimeout(timer);
  }, []);

  const retry = () => {
    setLoadState('loading');
    fetchUserData();
    if (!catalog) fetchCatalog();
  };

  // ---------- Loading / error screens ----------
  if (loadState === 'loading') {
    return (
      <AppShell footer={false}>
        <div role="status" className="flex flex-col py-32 items-center justify-center gap-3 text-gray-600 px-4 text-center">
          <Loader2 className="animate-spin text-green-600" size={40} aria-hidden="true" />
          <p className="font-bold text-xl">{t('Loading your dashboard…')}</p>
          <p className="text-sm text-gray-500">{t('The server may take up to 30 seconds to wake up.')}</p>
        </div>
      </AppShell>
    );
  }

  if (loadState === 'error' || loadState === 'missing') {
    const missing = loadState === 'missing';
    return (
      <AppShell footer={false}>
      <div role="alert" className="flex flex-col py-24 items-center justify-center gap-4 p-6 text-center">
        <WifiOff className="text-gray-400" size={48} />
        <h1 className="text-2xl font-bold text-gray-800">{missing ? t('Profile not found') : t('Could not load your dashboard')}</h1>
        <p className="text-gray-500 max-w-md">
          {missing
            ? t('Your login works, but your rewards profile is missing. Please contact support from the About page.')
            : `${loadError} ${t('Check your connection and try again.')}`}
        </p>
        <div className="flex gap-3">
          {!missing && (
            <button onClick={retry} className="flex items-center gap-2 bg-green-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-700">
              <RefreshCw size={18} /> {t('Try again')}
            </button>
          )}
          <button onClick={goToLogin} className="flex items-center gap-2 bg-gray-100 text-gray-700 px-5 py-3 rounded-xl font-bold hover:bg-gray-200">
            <LogOut size={18} /> {t('Log out')}
          </button>
        </div>
      </div>
      </AppShell>
    );
  }

  // ---------- Derived data ----------
  const { user, impact, progress } = data;
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const redemptions = Array.isArray(data.redemptions) ? data.redemptions : [];

  const earningsData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateString = d.toDateString();
    const dailyTotal = logs
      .filter((log) => log.accepted !== false && new Date(log.created_at).toDateString() === dateString)
      .reduce((sum, log) => sum + (Number(log.points) || 0), 0);
    earningsData.push({ name: d.toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { weekday: 'short' }), earnings: dailyTotal });
  }

  const pieData = WASTE_TYPES
    .map((w) => ({ name: t(w.label), color: w.color, value: logs.filter((l) => l.accepted !== false && l.waste_type === w.name).length }))
    .filter((d) => d.value > 0);

  const rewardByType = Object.fromEntries((catalog?.rewards || []).map((r) => [r.wasteType, r]));
  const vouchers = (catalog?.redeem || []).filter((r) => r.type === 'points');
  const withdrawal = (catalog?.redeem || []).find((r) => r.type === 'money');
  const needsTeam = !user.department || !user.hostel;
  const wallet = data.wallet || null;     // campus wallet (null until 004_wallet_cashback.sql is run)
  const cashback = data.cashback || null; // pending bonus (null when the programme is off)
  const refreshWallet = () => { fetchUserData(); setWalletKey((k) => k + 1); };

  return (
    <AppShell>
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">

      {/* HEADER */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{t('Hello, {name}!', { name: user.name })}</h1>
        <p className="text-gray-500">{t('Your impact and rewards at a glance.')}</p>
      </div>

      {user.is_blocked && (
        <div role="alert" className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4">
          <AlertTriangle className="flex-shrink-0" aria-hidden="true" />
          <p className="text-sm">{t('Your account is paused from earning rewards. Please contact the campus team.')}</p>
        </div>
      )}

      {needsTeam && <TeamSetup user={user} onSaved={() => { fetchUserData(); reloadProfile(); }} />}

      {/* WALLET: Eco-Points (coins) -> redeem into rupees -> spend only at campus counters */}
      {wallet ? (
        <section aria-label={t('Your wallet')} className="mb-8 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
            {/* Eco-Points (coins) */}
            <div className="p-6 flex flex-col">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Leaf size={16} aria-hidden="true" /></span>
                {t('Eco-Points')}
              </p>
              <p className="mt-3 text-4xl font-extrabold text-gray-900 leading-none">{wallet.points.toLocaleString('en-IN')}</p>
              <p className="mt-2 text-sm text-gray-500">{t('Worth ₹{n} · {rate} Eco-Points = ₹1', { n: wallet.redeemableInr, rate: wallet.pointsPerRupee })}</p>
              <div className="mt-auto pt-5">
                <button onClick={() => setConvertOpen(true)} disabled={wallet.redeemableInr < 1}
                  className="w-full py-2.5 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                  {t('Redeem to wallet')} <ArrowRight size={16} aria-hidden="true" />
                </button>
                {wallet.redeemableInr < 1 && <p className="text-xs text-gray-500 mt-2 text-center">{t('Collect {n} Eco-Points to redeem ₹1.', { n: wallet.pointsPerRupee })}</p>}
              </div>
            </div>

            {/* Rupee wallet */}
            <div className="p-6 flex flex-col">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                <span className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center"><Wallet size={16} aria-hidden="true" /></span>
                {t('Campus wallet')}
              </p>
              <p className="mt-3 text-4xl font-extrabold text-gray-900 leading-none">₹{wallet.inr}</p>
              <p className="mt-2 text-sm text-gray-500">{t('Spend only at campus counters.')}</p>
              <div className="mt-auto pt-5">
                <button onClick={() => setPayOpen(true)} className="w-full py-2.5 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 inline-flex items-center justify-center gap-2">
                  <Store size={16} aria-hidden="true" /> {t('Pay at counter')}
                </button>
              </div>
            </div>

            {/* Impact */}
            <div className="p-6 flex flex-col">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                <span className="w-8 h-8 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center"><TreePine size={16} aria-hidden="true" /></span>
                {t('CO₂ saved')} <span className="text-xs font-normal">{t('(est.)')}</span>
              </p>
              <p className="mt-3 text-4xl font-extrabold text-gray-900 leading-none">{formatCo2(impact?.co2Kg)}</p>
              <p className="mt-2 text-sm text-gray-500">
                {t('{n} items · {kg} recycled', { n: impact?.items ?? 0, kg: formatKg(impact?.wasteKg) })}
                {impact?.measuredItems ? ` · ${t('{n} weighed by the bin', { n: impact.measuredItems })}` : ''}
              </p>
            </div>
          </div>

          {/* Bonus Eco-Points on the way */}
          {cashback && cashback.nextMilestone && (
            <div className="border-t border-gray-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-700 flex-shrink-0">
                <Sparkles size={18} className="text-amber-500" aria-hidden="true" />
                {t('Bonus Eco-Points on the way')}
                <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">+{cashback.pending}</span>
              </p>
              <div className="flex-1 min-w-0">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden" aria-hidden="true">
                  <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${Math.min(100, (cashback.cycleItems / cashback.nextMilestone) * 100)}%` }} />
                </div>
              </div>
              <p className="text-sm text-gray-500 flex-shrink-0">
                {t('{n} more items to unlock', { n: cashback.itemsToNext })} · {cashback.cycleItems}/{cashback.nextMilestone}
              </p>
            </div>
          )}
          {cashback?.expiresAt && cashback.pending > 0 && (
            <p className="px-6 pb-4 -mt-2 text-xs text-gray-500">{t('Recycle before {date} to keep it', { date: formatDate(cashback.expiresAt) })}</p>
          )}
        </section>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">{t('Wallet balance')}</h2>
            <p className="text-4xl font-bold text-green-600">₹{user.walletBalance ?? 0}</p>
            {withdrawal && (
              <button onClick={() => setRedeemEntry(withdrawal)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded mt-2 font-bold hover:bg-green-200">
                {t('Withdraw ₹{n} to UPI', { n: withdrawal.cost })}
              </button>
            )}
          </div>
          <Wallet className="text-green-600" size={40} aria-hidden="true" />
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">{t('Eco Points')}</h2>
            <p className="text-4xl font-bold text-blue-600">{user.ecoPoints ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">{t('Redeem for campus credits below')}</p>
          </div>
          <Leaf className="text-blue-600" size={40} aria-hidden="true" />
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">{t('CO₂ saved')} <span className="text-xs">{t('(est.)')}</span></h2>
            <p className="text-4xl font-bold text-yellow-600">{formatCo2(impact?.co2Kg)}</p>
            <p className="text-xs text-gray-500 mt-1">
              {t('{n} items · {kg} recycled', { n: impact?.items ?? 0, kg: formatKg(impact?.wasteKg) })}
              {impact?.measuredItems ? ` · ${t('{n} weighed by the bin', { n: impact.measuredItems })}` : ''}
            </p>
          </div>
          <TreePine className="text-yellow-600" size={40} aria-hidden="true" />
        </div>
      </div>
      )}

      {/* PRIMARY ACTIONS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => navigate('/scan')}
          className="bg-gradient-to-r from-green-600 to-emerald-600 text-white w-full py-4 sm:py-5 text-lg sm:text-xl rounded-2xl shadow-lg hover:shadow-xl hover:scale-[1.01] transition transform font-bold flex items-center justify-center gap-3"
        >
          <ScanQrCode aria-hidden="true" /> {t('Scan a bin')}
        </button>
        <button
          onClick={() => navigate('/map')}
          className="bg-white text-green-700 border-2 border-green-600 w-full py-4 sm:py-5 text-lg sm:text-xl rounded-2xl shadow-sm hover:bg-green-50 transition font-bold flex items-center justify-center gap-3"
        >
          <MapIcon aria-hidden="true" /> {t('Find nearby bins')}
        </button>
      </div>

      {/* LEAGUES: streak, rank, challenges, badges */}
      {progress && (
        <section aria-label={t('Campus leagues')} className="space-y-4 sm:space-y-6 mb-10">
          <StreakAndRank progress={progress} />
          {/* Full-width rows: side by side, the short challenges card stretched to the badges' height. */}
          <Challenges progress={progress} onClaimed={fetchUserData} onUnauthorized={goToLogin} />
          <Badges badges={progress.badges} />
        </section>
      )}

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-10">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80 flex flex-col">
          <h3 className="text-lg font-bold mb-4 text-gray-700">{t('Points trend')}</h3>
          {/* The chart gets the space under the title (not 100% of the card), so axis labels stay inside. */}
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={earningsData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="name" stroke={chart.axis} tick={{ fill: chart.axis, fontSize: 12 }} interval={0} tickMargin={8} padding={{ left: 16, right: 16 }} />
              <YAxis allowDecimals={false} stroke={chart.axis} tick={{ fill: chart.axis, fontSize: 12 }} width={32} />
              <Tooltip contentStyle={chart.tooltip} labelStyle={{ color: chart.tooltip.color }} formatter={(value) => [t('{n} pts', { n: value }), t('Points')]} />
              <Line type="monotone" dataKey="earnings" stroke="#16a34a" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80 flex flex-col">
          <h3 className="text-lg font-bold mb-4 text-gray-700">{t('Waste distribution')}</h3>
          {pieData.length > 0 ? (
            <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none">
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={chart.tooltip} itemStyle={{ color: chart.tooltip.color }} formatter={(value, name) => [t('{n} items', { n: value }), name]} />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={10} wrapperStyle={{ color: chart.axis, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 gap-2">
              <span className="text-4xl">♻️</span>
              <p>{t('No items recycled yet.')}</p>
              <p className="text-sm">{t('Scan a bin and deposit your first item to see your mix here.')}</p>
            </div>
          )}
        </div>
      </div>

      {/* BBMP SEGREGATION + REWARD GUIDE */}
      <div className="mb-10">
        <h3 className="text-lg font-bold mb-1 text-gray-700">{t('Segregation & reward guide')}</h3>
        <p className="text-sm text-gray-500 mb-4">{t('Bengaluru (BBMP) rules: dry, wet and reject waste go in separate bins.')}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {WASTE_TYPES.map((w) => {
            const r = rewardByType[w.name];
            const stream = r ? streamOf(r.stream) : null;
            return (
              <div key={w.name} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style={{ background: `${w.color}18`, border: `1px solid ${w.color}44` }}>
                  {w.emoji}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 text-sm leading-tight">{t(w.label)}</p>
                  {stream && (
                    <p className="text-[11px] font-semibold" style={{ color: stream.color }}>{t(stream.label)} · {t(stream.bin)}</p>
                  )}
                  <p className="text-xs font-bold mt-0.5" style={{ color: w.color }}>
                    {r ? (r.reward > 0 ? t('+₹{reward} · +{points} pts per item', { reward: r.reward, points: r.points }) : t('+{points} pts per item', { points: r.points })) : catalogFailed ? t('Reward unavailable') : t('Loading…')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* REWARDS SHOP: campus credits (old fixed vouchers; hidden once the wallet replaces them) */}
      {(!wallet || vouchers.length > 0) && (
      <div className="mb-10">
        <h3 className="text-2xl font-bold mb-1 text-gray-800 flex items-center gap-2">
          <Ticket className="text-blue-600" /> {t('Campus credits')}
        </h3>
        <p className="text-sm text-gray-500 mb-6">{wallet ? t('Spend your campus wallet at the canteen, snack stall, stationery store and print centre.') : t('Redeem Eco Points for credits at the canteen, stationery store and print centre. Show the code at the counter.')}</p>
        {catalogFailed && !catalog ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center text-gray-500">
            {t('Could not load rewards.')}{' '}
            <button onClick={fetchCatalog} className="text-green-700 font-bold underline">{t('Retry')}</button>
          </div>
        ) : !catalog ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={18} /> {t('Loading rewards…')}
          </div>
        ) : wallet && vouchers.length === 0 ? (
          <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="font-bold text-gray-900">{t('Pay any amount: ₹2 for a photocopy, ₹70 for a record book')}</p>
              <p className="text-sm text-gray-600 mt-1">{t('Choose the counter and amount, then show the one-time code. Only that amount is used; the rest stays in your wallet.')}</p>
            </div>
            <button onClick={() => setPayOpen(true)} className="px-5 py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2 flex-shrink-0">
              <Store size={18} aria-hidden="true" /> {t('Pay at a counter')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {vouchers.map((v) => {
              const { Icon, bg, fg } = itemStyle(v.item);
              const affordable = (user.ecoPoints ?? 0) >= v.cost;
              return (
                <div key={v.item} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition flex flex-col">
                  <div className={`${bg} w-12 h-12 rounded-full flex items-center justify-center mb-4`}><Icon className={fg} /></div>
                  <h4 className="text-lg font-bold text-gray-900">{localized(v, 'item', lang)}</h4>
                  <p className="text-gray-500 text-sm">{localized(v, 'description', lang)}</p>
                  {v.vendor && <p className="text-xs text-gray-400 mt-1 mb-4 flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {localized(v, 'vendor', lang)}</p>}
                  <div className="flex justify-between items-center mt-auto pt-2">
                    <span className="font-bold text-blue-600">{t('{n} pts', { n: v.cost })}</span>
                    <button
                      onClick={() => setRedeemEntry(v)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold ${affordable ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {affordable ? t('Redeem') : t('Need {n} more', { n: v.cost - (user.ecoPoints ?? 0) })}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      )}

      {wallet && <WalletHistory refreshKey={walletKey} />}

      {/* REDEMPTION HISTORY */}
      <div className="mb-10">
        <h3 className="text-xl font-bold mb-4 text-gray-700 flex items-center gap-2"><Receipt /> {t('Redemption history')}</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {redemptions.length > 0 ? (
            redemptions.slice(0, 10).map((r) => (
              <div key={r.code} className="p-4 border-b border-gray-100 last:border-0 flex justify-between items-center gap-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800">{r.type === 'money' ? t('UPI withdrawal') : r.item}</p>
                  <p className="text-xs text-gray-500">{formatDateTime(r.created_at)}</p>
                  <p className="text-xs font-mono text-gray-600 mt-1">{t('Code')}: {r.code}{r.upi_id ? ` · ${r.upi_id}` : ''}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="font-bold text-gray-700">{r.type === 'money' ? `-₹${r.cost}` : t('-{n} pts', { n: r.cost })}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {t(STATUS_LABEL[r.status] || r.status)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-gray-500">{t('No redemptions yet. Your vouchers and withdrawals will appear here.')}</div>
          )}
        </div>
      </div>

      {/* RECENT ACTIVITY */}
      <div className="mt-8">
        <h3 className="text-xl font-bold mb-4 text-gray-700 flex items-center gap-2"><History /> {t('Recent activity')}</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {logs.length > 0 ? (
            logs.slice(0, 8).map((log) => {
              const w = WASTE_BY_NAME[log.waste_type];
              const color = w?.color || '#6B7280';
              const wrong = log.accepted === false;
              return (
                <div key={log.id} className="p-4 border-b border-gray-100 last:border-0 flex justify-between items-center gap-3 hover:bg-gray-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${color}18`, border: `1px solid ${color}44` }}>
                      {w?.emoji || '♻️'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold" style={{ color }}>{t(w?.label || log.waste_type)}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {formatDateTime(log.created_at)}
                        {log.measured_weight_kg ? <> · <Scale size={11} className="inline" aria-hidden="true" /> {formatKg(log.measured_weight_kg)}</> : null}
                      </p>
                      {wrong && <p className="text-xs font-semibold text-amber-700">{t('Wrong bin — use a {bin}', { bin: t(streamOf(log.stream).bin).toLowerCase() })}</p>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={wrong ? 'text-gray-400 font-bold' : 'text-green-600 font-bold'}>{wrong ? '₹0' : `+₹${log.reward_inr}`}</span>
                    <p className="hidden sm:flex text-emerald-600 text-xs font-bold items-center gap-1 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200 max-w-[14rem] truncate">
                      <MapPin size={12} /> {log.bin_name || t('Unknown location')}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-center text-gray-500">{t('No activity yet. Scan some items to see data!')}</div>
          )}
        </div>
      </div>

      {/* BBMP colour key */}
      <div className="mt-10 grid sm:grid-cols-3 gap-3">
        {['dry', 'wet', 'reject'].map((k) => (
          <div key={k} className="rounded-xl p-4 bg-white border border-gray-100 flex items-start gap-3">
            <span className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ background: STREAMS[k].color }} aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-gray-800">{t(STREAMS[k].label)} · {t(STREAMS[k].bin)}</p>
              <p className="text-xs text-gray-500">{t(STREAMS[k].examples)}</p>
            </div>
          </div>
        ))}
      </div>

      {payOpen && <PayModal onClose={() => { setPayOpen(false); refreshWallet(); }} onPaid={refreshWallet} onNeedMoney={() => { setPayOpen(false); setConvertOpen(true); }} />}
      {convertOpen && wallet && <ConvertModal wallet={wallet} onClose={() => setConvertOpen(false)} onConverted={refreshWallet} />}
      {redeemEntry && (
        <RedeemModal
          entry={redeemEntry}
          walletBalance={user.walletBalance}
          ecoPoints={user.ecoPoints}
          onClose={() => setRedeemEntry(null)}
          onRedeemed={fetchUserData}
          onUnauthorized={goToLogin}
        />
      )}
    </div>
    </AppShell>
  );
}
