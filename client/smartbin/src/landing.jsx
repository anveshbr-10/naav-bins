import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './authContext';
import { useI18n, tk } from './i18n';
import useImpactStats from './useImpactStats';
import { formatCo2, formatCount, formatInr, formatKg } from './format';
import { Recycle, ArrowRight, Wallet, TreePine, ScanQrCode, Sparkles, Gift, MapPin, Trophy, ShieldCheck } from 'lucide-react';
import AppShell from './layout';
import { BRAND_NAME } from './brand';
import { STREAMS } from './waste';

const STEPS = [
  { icon: ScanQrCode, title: tk('Scan the bin'), text: tk('Stand at a {brand} bin and scan its QR code (or the live code on its screen) to start a session.') },
  { icon: Sparkles, title: tk('Show & sort'), text: tk('Show the item to your camera. The AI identifies the material and tells you which bin it belongs in.') },
  { icon: Gift, title: tk('Earn campus credits'), text: tk('Points land instantly. Spend them at the canteen, stationery store or print centre — or withdraw to UPI.') },
];

const FEATURES = [
  { icon: Trophy, title: tk('Campus leagues'), text: tk('Department vs department, hostel vs hostel, with streaks, badges and weekly challenges.') },
  { icon: ShieldCheck, title: tk('Fair by design'), text: tk('Signed and rotating QR codes, a 50 m geofence and duplicate-photo checks keep rewards honest.') },
  { icon: MapPin, title: tk('Find the right bin'), text: tk('A live map shows every bin, its waste stream and how full it is.') },
];

function StatCard({ icon, tint, value, label, note }) {
  const Icon = icon;
  return (
    <div className="p-6 sm:p-8 rounded-2xl bg-white border border-gray-100 shadow-sm text-center">
      <div className={`${tint} w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4`}>
        <Icon className="w-7 h-7" aria-hidden="true" />
      </div>
      <p className="text-3xl sm:text-4xl font-extrabold text-gray-900 tabular-nums">{value}</p>
      <h3 className="text-gray-600 font-semibold mt-1">{label}</h3>
      <p className="text-xs text-gray-500 mt-1">{note}</p>
    </div>
  );
}

export default function Landing() {
  const { t } = useI18n();
  const { status, home } = useAuth();
  const session = status === 'signedIn';
  const { status: statsStatus, stats } = useImpactStats();
  const show = (fn) => (statsStatus === 'ready' ? fn(stats) : statsStatus === 'loading' ? '…' : '—');

  const primary = 'inline-flex items-center justify-center gap-2 bg-green-600 text-white px-7 py-3.5 rounded-full text-base sm:text-lg font-bold hover:bg-green-700 transition shadow-lg shadow-green-600/20';
  const secondary = 'inline-flex items-center justify-center gap-2 bg-white text-green-700 border-2 border-green-600 px-7 py-3.5 rounded-full text-base sm:text-lg font-bold hover:bg-green-50 transition';

  return (
    <AppShell>
      {/* HERO */}
      <section className="bg-gradient-to-b from-green-50 to-white">
        <div className="max-w-6xl mx-auto px-4 pt-14 pb-16 sm:pt-20 sm:pb-24 text-center">
          <p className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-800 text-xs sm:text-sm font-bold px-3 py-1 mb-6">
            <Recycle size={16} aria-hidden="true" /> {t('AI-assisted recycling for Bengaluru campuses')}
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {t('Sort it right.')}<br />
            <span className="text-green-600">{t('Earn for keeping your campus clean.')}</span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            {t('Scan a smart bin, show your item to the camera, and earn campus credits for putting it in the right bin.')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {session ? (
              <Link to={home} className={primary}>{t('Go to your dashboard')} <ArrowRight size={20} aria-hidden="true" /></Link>
            ) : (
              <Link to="/register" className={primary}>{t('Create a free account')} <ArrowRight size={20} aria-hidden="true" /></Link>
            )}
            <Link to="/map" className={secondary}><MapPin size={20} aria-hidden="true" /> {t('Find a bin')}</Link>
          </div>
        </div>
      </section>

      {/* LIVE STATS */}
      <section aria-labelledby="impact-title" className="max-w-6xl mx-auto px-4 -mt-6 sm:-mt-10 pb-16">
        <h2 id="impact-title" className="sr-only">{t('Live impact')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <StatCard
            icon={Recycle} tint="bg-green-100 text-green-700"
            value={show((s) => formatCount(s.items))} label={t('Items recycled')}
            note={show((s) => t('~{kg} diverted from landfill', { kg: formatKg(s.wasteKg) }))}
          />
          <StatCard
            icon={Wallet} tint="bg-blue-100 text-blue-700"
            value={show((s) => formatInr(s.rewardsIssued))} label={t('Rewards earned')}
            note={show((s) => t('by {n} eco-warriors', { n: formatCount(s.users) }))}
          />
          <StatCard
            icon={TreePine} tint="bg-amber-100 text-amber-700"
            value={show((s) => formatCo2(s.co2Kg))} label={t('CO₂ saved (est.)')}
            note={show((s) => t('{active} of {total} smart bins active', { active: s.activeBins, total: s.bins }))}
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section aria-labelledby="how-title" className="bg-green-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 sm:py-20">
          <h2 id="how-title" className="text-3xl font-extrabold text-center mb-12">{t('How it works')}</h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map(({ icon, title, text }, i) => {
              const StepIcon = icon;
              return (
                <li key={title} className="rounded-2xl bg-white/5 border border-white/10 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-10 h-10 rounded-full bg-green-500 text-green-950 font-extrabold flex items-center justify-center">{i + 1}</span>
                    <StepIcon className="text-green-300" aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{t(title)}</h3>
                  <p className="text-green-100/90">{t(text, { brand: BRAND_NAME })}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* BBMP SEGREGATION GUIDE */}
      <section aria-labelledby="bbmp-title" className="max-w-6xl mx-auto px-4 py-16">
        <h2 id="bbmp-title" className="text-2xl sm:text-3xl font-extrabold text-gray-900 text-center">{t('Segregate the Bengaluru way')}</h2>
        <p className="text-gray-600 text-center mt-2 mb-10 max-w-2xl mx-auto">{t('BBMP rules ask every campus and home to keep three streams apart at the source. The app tells you which one each item belongs to.')}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {['dry', 'wet', 'reject'].map((k) => {
            const s = STREAMS[k];
            return (
              <div key={k} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6" style={{ borderTop: `4px solid ${s.color}` }}>
                <p className="text-3xl mb-2" aria-hidden="true">{s.icon}</p>
                <h3 className="text-lg font-bold text-gray-900">{t(s.label)}</h3>
                <p className="text-sm font-semibold" style={{ color: s.color }}>{t(s.bin)}</p>
                <p className="text-sm text-gray-600 mt-3">{t(s.examples)}</p>
                <p className="text-xs text-gray-500 mt-2">{t(s.rule)}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* FEATURES */}
      <section className="bg-white border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-14 grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map(({ icon, title, text }) => {
            const Icon = icon;
            return (
              <div key={title} className="flex gap-4">
                <div className="w-11 h-11 rounded-xl bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0"><Icon size={22} aria-hidden="true" /></div>
                <div>
                  <h3 className="font-bold text-gray-900">{t(title)}</h3>
                  <p className="text-sm text-gray-600 mt-1">{t(text)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      {!session && (
        <section className="max-w-6xl mx-auto px-4 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">{t('Ready to make your first deposit?')}</h2>
          <p className="text-gray-600 mt-2 mb-8">{t('It takes less than a minute to sign up.')}</p>
          <Link to="/register" className={primary}>{t('Join {brand}', { brand: BRAND_NAME })} <ArrowRight size={20} aria-hidden="true" /></Link>
        </section>
      )}
    </AppShell>
  );
}
