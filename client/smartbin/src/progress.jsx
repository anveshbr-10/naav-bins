import React, { useState } from 'react';
import { Flame, Trophy, Target, Award, Loader2, CheckCircle2, Gift, Lock } from 'lucide-react';
import api, { apiErrorMessage, apiStatus } from './api';
import { useI18n, tk } from './i18n';
import { WASTE_BY_NAME } from './waste';

// Badge ids come from the server; names and descriptions live here so they can be translated.
const BADGE_INFO = {
  first_drop:     { icon: '🌱', name: tk('First drop'),       desc: tk('Recycle your first item') },
  ten_strong:     { icon: '🔟', name: tk('Ten strong'),       desc: tk('Recycle 10 items') },
  half_century:   { icon: '🥈', name: tk('Half century'),     desc: tk('Recycle 50 items') },
  century:        { icon: '🏆', name: tk('Century'),          desc: tk('Recycle 100 items') },
  streak_3:       { icon: '🔥', name: tk('On a roll'),        desc: tk('Recycle 3 days in a row') },
  streak_7:       { icon: '⚡', name: tk('Week warrior'),     desc: tk('Recycle 7 days in a row') },
  plastic_hunter: { icon: '🧴', name: tk('Plastic hunter'),   desc: tk('Recycle 25 plastic items') },
  paper_saver:    { icon: '📦', name: tk('Paper saver'),      desc: tk('Recycle 25 paper or cardboard items') },
  composter:      { icon: '🌿', name: tk('Composter'),        desc: tk('Put 10 wet-waste items in the right bin') },
  all_rounder:    { icon: '🎯', name: tk('All-rounder'),      desc: tk('Recycle 5 different materials') },
  early_bird:     { icon: '🌅', name: tk('Early bird'),       desc: tk('Recycle before 8 AM') },
  clean_sorter:   { icon: '✨', name: tk('Clean sorter'),     desc: tk('20 items without a single wrong-bin attempt') },
};

function challengeText(c, t) {
  switch (c.metric) {
    case 'items': return t('Recycle {n} items this week', { n: c.target });
    case 'type': return t('Recycle {n} {material} items', { n: c.target, material: t(WASTE_BY_NAME[c.wasteType]?.label || c.wasteType) });
    case 'days': return t('Recycle on {n} different days', { n: c.target });
    case 'types': return t('Recycle {n} different materials', { n: c.target });
    case 'clean': return t('Recycle {n} items with no wrong-bin attempts', { n: c.target });
    default: return c.slug;
  }
}

function Bar({ value, max, color = 'bg-green-600' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StreakAndRank({ progress }) {
  const { t } = useI18n();
  const { streak, rank, weekItems, weekPoints } = progress;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${streak.current ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
          <Flame size={30} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500 font-medium">{t('Daily streak')}</p>
          <p className="text-3xl font-extrabold text-gray-900">{t('{n} days', { n: streak.current })}</p>
          <p className="text-xs text-gray-500">
            {streak.activeToday ? t('Done for today — come back tomorrow!') : streak.current ? t('Recycle today to keep it going.') : t('Recycle today to start a streak.')}
            {' · '}{t('Best: {n}', { n: streak.longest })}
          </p>
        </div>
      </div>
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-blue-100 text-blue-700">
          <Trophy size={28} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500 font-medium">{t('This week')}</p>
          <p className="text-3xl font-extrabold text-gray-900">{t('{n} pts', { n: weekPoints })}</p>
          <p className="text-xs text-gray-500 truncate">
            {t('{n} items', { n: weekItems })}
            {rank?.individual ? ` · ${t('Rank #{rank} on campus', { rank: rank.individual })}` : ''}
            {rank?.department ? ` · ${t('Dept #{rank}', { rank: rank.department.rank })}` : ''}
            {rank?.hostel ? ` · ${t('Hostel #{rank}', { rank: rank.hostel.rank })}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Challenges({ progress, onClaimed, onUnauthorized }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const ends = new Date(progress.week.end);

  const claim = async (c) => {
    setBusy(c.id);
    setError(null);
    try {
      await api.post('/api/challenges/claim', { challengeId: c.id });
      onClaimed();
    } catch (err) {
      if (apiStatus(err) === 401) { onUnauthorized(); return; }
      setError(apiErrorMessage(err, tk('Could not claim the bonus. Please try again.')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Target size={20} className="text-green-600" aria-hidden="true" /> {t('Weekly challenges')}</h3>
        <p className="text-xs text-gray-500">{t('New challenges every Monday · ends {date}', { date: ends.toLocaleDateString() })}</p>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
      <ul className="space-y-4">
        {progress.challenges.map((c) => (
          <li key={c.id} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2 text-sm mb-1">
                <span className="font-semibold text-gray-800">{challengeText(c, t)}</span>
                <span className="text-gray-500 flex-shrink-0">{c.progress}/{c.target}</span>
              </div>
              <Bar value={c.progress} max={c.target} color={c.completed ? 'bg-green-600' : 'bg-blue-600'} />
            </div>
            {c.claimed ? (
              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                <CheckCircle2 size={14} aria-hidden="true" /> {t('+{n} pts', { n: c.bonus })}
              </span>
            ) : (
              <button
                onClick={() => claim(c)}
                disabled={!c.completed || busy === c.id}
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} aria-hidden="true" />}
                {c.completed ? t('Claim +{n}', { n: c.bonus }) : t('+{n} pts', { n: c.bonus })}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Badges({ badges }) {
  const { t } = useI18n();
  const earned = badges.filter((b) => b.earned).length;
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Award size={20} className="text-amber-600" aria-hidden="true" /> {t('Badges')}</h3>
        <p className="text-xs text-gray-500">{t('{n} of {total} earned', { n: earned, total: badges.length })}</p>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {badges.map((b) => {
          const info = BADGE_INFO[b.id] || { icon: '🏅', name: b.id, desc: '' };
          return (
            <li key={b.id} className={`rounded-xl p-3 border flex flex-col ${b.earned ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`} title={t(info.desc)}>
              <div className="flex items-start justify-between gap-2">
                <span className={`text-2xl leading-none ${b.earned ? '' : 'grayscale opacity-50'}`} aria-hidden="true">{info.icon}</span>
                {b.earned
                  ? <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('Earned')}</span>
                  : <Lock size={14} className="text-gray-400 flex-shrink-0" aria-label={t('Locked')} />}
              </div>
              <p className={`mt-2 text-sm font-bold leading-snug ${b.earned ? 'text-gray-900' : 'text-gray-600'}`}>{t(info.name)}</p>
              <p className="mt-0.5 text-xs text-gray-500 leading-snug">{t(info.desc)}</p>
              {!b.earned && b.target > 1 && (
                <div className="mt-auto pt-3">
                  <Bar value={b.progress} max={b.target} color="bg-amber-500" />
                  <p className="mt-1 text-[11px] text-gray-500 tabular-nums">{b.progress}/{b.target}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
