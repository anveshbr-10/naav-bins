import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Medal, Award, Loader2, Crown, RefreshCw, WifiOff, Building2, Home, User, Flame, Target } from 'lucide-react';
import AppShell from './layout';
import api from './api';
import { useAuth } from './authContext';
import { useI18n, localized, tk } from './i18n';

const TABS = [
  { id: 'departments', label: tk('Departments'), icon: Building2 },
  { id: 'hostels', label: tk('Hostels'), icon: Home },
  { id: 'individuals', label: tk('Individuals'), icon: User },
];

const PODIUM = [
  { card: 'bg-gradient-to-b from-yellow-50 to-white p-3 sm:p-6 rounded-t-2xl shadow-2xl border-t-4 border-yellow-400 relative z-10', icon: <Crown aria-hidden="true" className="w-12 h-12 mx-auto text-yellow-500 mb-2 -mt-8 bg-white rounded-full p-1 shadow-sm" />, name: 'font-bold text-slate-800 text-lg truncate', points: 'text-emerald-600 font-black text-xl' },
  { card: 'bg-white p-3 sm:p-4 rounded-t-2xl rounded-bl-2xl shadow-lg border-t-4 border-gray-300 transform translate-y-4', icon: <Medal aria-hidden="true" className="w-10 h-10 mx-auto text-gray-400 mb-2" />, name: 'font-bold text-slate-800 truncate', points: 'text-emerald-600 font-extrabold' },
  { card: 'bg-white p-3 sm:p-4 rounded-t-2xl rounded-br-2xl shadow-lg border-t-4 border-amber-600 transform translate-y-8', icon: <Award aria-hidden="true" className="w-10 h-10 mx-auto text-amber-600 mb-2" />, name: 'font-bold text-slate-800 truncate', points: 'text-emerald-600 font-extrabold' },
];

export default function Leagues() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { status, profile } = useAuth();
  const session = status === 'signedIn';
  const [tab, setTab] = useState('departments');
  const [period, setPeriod] = useState('week');
  const [state, setState] = useState({ status: 'loading', data: null, period: 'week' });

  const load = useCallback((p) => api.get('/api/leagues', { params: { period: p } })
    .then((res) => setState({ status: 'ready', data: res.data, period: p }))
    .catch(() => setState((s) => ({ ...s, status: 'error' }))), []);

  useEffect(() => { load(period); }, [load, period]);

  const retry = () => { setState((s) => ({ ...s, status: 'loading' })); load(period); };
  const data = state.data;
  const rows = data ? data[tab] || [] : [];
  const mine = tab === 'departments' ? profile?.department : tab === 'hostels' ? profile?.hostel : null;
  const nameOf = (r) => (tab === 'individuals' ? r.name : localized(r, 'name', lang));
  const groupNames = Object.fromEntries([...(data?.departments || []), ...(data?.hostels || [])].map((g) => [g.id, localized(g, 'name', lang)]));
  // Rows are sorted by points; the podium shows the top three that have scored (classic 2-1-3 order).
  const onPodium = Math.min(3, rows.filter((r) => r.points > 0).length);
  const podium = [1, 0, 2].filter((i) => i < onPodium).map((i) => ({ ...rows[i], style: PODIUM[i] }));
  const rest = rows.slice(onPodium);
  const weekEnds = data?.week?.end ? new Date(data.week.end).toLocaleDateString() : '';

  return (
    <AppShell>
    <div className="pb-16">
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-600 to-green-800 text-white pt-10 pb-24 px-4 text-center rounded-b-[2rem] sm:rounded-b-[3rem] shadow-xl relative">
        <Trophy className="w-14 h-14 mx-auto mb-4 text-yellow-300" aria-hidden="true" />
        <h1 className="text-3xl sm:text-4xl font-extrabold mb-2 tracking-tight">{t('Campus leagues')}</h1>
        <p className="text-emerald-100 opacity-90 max-w-xl mx-auto">{t('Department vs department, hostel vs hostel. Every item you recycle scores for your team.')}</p>

        <div className="mt-6 inline-flex rounded-full bg-white/10 p-1" role="group" aria-label={t('Period')}>
          {[['week', tk('This week')], ['all', tk('All time')]].map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)} aria-pressed={period === id}
              className={`px-4 py-1.5 rounded-full text-sm font-bold transition ${period === id ? 'bg-white text-emerald-800' : 'text-white hover:bg-white/10'}`}>
              {t(label)}
            </button>
          ))}
        </div>
        {period === 'week' && weekEnds && <p className="text-xs text-emerald-100 mt-2">{t('Resets every Monday · this week ends {date}', { date: weekEnds })}</p>}
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-16 relative z-10">
        {/* Tabs */}
        <div role="tablist" aria-label={t('League')} className="grid grid-cols-3 gap-1 bg-white rounded-2xl shadow-lg p-1 mb-10">
          {TABS.map(({ id, label, icon }) => {
            const Icon = icon;
            return (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition ${tab === id ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon size={16} aria-hidden="true" /> <span className="truncate">{t(label)}</span>
              </button>
            );
          })}
        </div>

        {state.status === 'loading' && (
          <div role="status" className="flex flex-col items-center justify-center mt-10">
            <Loader2 className="animate-spin w-12 h-12 text-emerald-500 mb-4" />
            <p className="text-slate-500 font-medium">{t('Ranking teams…')}</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <WifiOff className="w-10 h-10 mx-auto text-slate-400 mb-3" />
            <p className="font-bold text-slate-800">{t('Could not load the leagues')}</p>
            <p className="text-sm text-slate-500 mt-1">{t('The server may be waking up. Please try again.')}</p>
            <button onClick={retry} className="mt-5 inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700">
              <RefreshCw size={16} /> {t('Try again')}
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {session && profile?.role === 'user' && (tab !== 'individuals') && !mine && (
              <button onClick={() => navigate('/dashboard')} className="w-full mb-6 text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 hover:bg-amber-100">
                {t('You have not joined a team yet. Pick your department and hostel on your dashboard.')}
              </button>
            )}

            {podium.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg p-10 text-center mb-8">
                <p className="text-4xl mb-3">🌱</p>
                <p className="font-bold text-slate-800 text-lg">{t('No points on the board yet')}</p>
                <p className="text-slate-500 mt-1">{t('Recycle an item to put your team on top.')}</p>
                <button onClick={() => navigate(session ? '/scan' : '/register')} className="mt-6 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700">
                  {session ? t('Scan a bin') : t('Join now')}
                </button>
              </div>
            ) : (
              <>
                <h2 className="sr-only">{t('Top three')}</h2>
                <div className={`grid gap-2 sm:gap-4 mb-12 items-end ${podium.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' : podium.length === 2 ? 'grid-cols-2 max-w-lg mx-auto' : 'grid-cols-3'}`}>
                  {podium.map((p, i) => (
                    <div key={`${p.rank}-${nameOf(p)}-${i}`} className={`${p.style.card} text-center ${mine && p.id === mine ? 'ring-2 ring-emerald-500' : ''}`}>
                      {p.style.icon}
                      <p className="text-xs font-bold text-slate-400">#{p.rank}</p>
                      <h3 className={p.style.name}>{nameOf(p)}</h3>
                      <p className={p.style.points}>{t('{n} pts', { n: p.points })}</p>
                      <p className="text-[11px] text-slate-500">{t('{n} items', { n: p.items })}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {rest.length > 0 && (
              <ol aria-label={t('Other ranks')} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {rest.map((r, index) => {
                  const isMine = mine && r.id === mine;
                  return (
                    <li key={`${r.rank}-${nameOf(r)}-${index}`} className={`flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-100 last:border-0 ${isMine ? 'bg-emerald-50' : 'hover:bg-slate-50'} transition`}>
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 flex-shrink-0">#{r.rank}</div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate">{nameOf(r)} {isMine && <span className="text-xs text-emerald-700">· {t('Your team')}</span>}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {tab === 'individuals'
                              ? [groupNames[r.department], groupNames[r.hostel]].filter(Boolean).join(' · ') || t('{n} items', { n: r.items })
                              : t('{active} of {members} members active · {per} pts per member', { active: r.activeMembers, members: r.members, per: r.pointsPerMember })}
                          </p>
                        </div>
                      </div>
                      <div className="font-extrabold text-emerald-600 flex-shrink-0 text-right">
                        {r.points} <span className="text-xs text-emerald-400 font-medium">{t('pts')}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* How it works */}
            <div className="mt-10 grid sm:grid-cols-3 gap-3">
              {[
                { icon: Target, title: tk('Weekly challenges'), text: tk('Three new goals every Monday. Complete them for bonus points.') },
                { icon: Flame, title: tk('Streaks'), text: tk('Recycle every day to grow your streak and unlock badges.') },
                { icon: Trophy, title: tk('Fair play'), text: tk('Points only count for items scanned at a real bin, in the right stream.') },
              ].map(({ icon, title, text }) => {
                const Icon = icon;
                return (
                  <div key={title} className="bg-white rounded-2xl p-4 border border-slate-100">
                    <Icon className="text-emerald-600 mb-2" size={20} aria-hidden="true" />
                    <p className="font-bold text-slate-800 text-sm">{t(title)}</p>
                    <p className="text-xs text-slate-500 mt-1">{t(text)}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
    </AppShell>
  );
}
