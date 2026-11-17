import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './authContext';
import useImpactStats from './useImpactStats';
import { formatCo2, formatCount, formatInr, formatKg } from './format';
import { Recycle, ArrowRight, Wallet, TreePine, ScanQrCode, Sparkles, Gift, MapPin } from 'lucide-react';
import AppShell from './layout';
import { BRAND_NAME } from './brand';

const STEPS = [
  { icon: ScanQrCode, title: 'Scan the bin', text: `Find a ${BRAND_NAME} bin on the map and scan its QR code to start a session.` },
  { icon: Sparkles, title: 'Show & dispose', text: 'Show the item to your camera. The AI identifies the material and tells you which bin to use.' },
  { icon: Gift, title: 'Earn rewards', text: 'Money and Eco-Points land in your wallet instantly, ready to redeem for vouchers or UPI.' },
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
            <Recycle size={16} aria-hidden="true" /> AI-assisted recycling for campuses
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Turn trash into cash.<br />
            <span className="text-green-600">Earn by keeping your campus clean.</span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            Scan a smart bin, show your item to the camera, and get paid for sorting it right.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {session ? (
              <>
                <Link to={home} className={primary}>Go to your dashboard <ArrowRight size={20} aria-hidden="true" /></Link>
                <Link to="/map" className={secondary}><MapPin size={20} aria-hidden="true" /> Find a bin</Link>
              </>
            ) : (
              <>
                <Link to="/register" className={primary}>Create a free account <ArrowRight size={20} aria-hidden="true" /></Link>
                <Link to="/map" className={secondary}><MapPin size={20} aria-hidden="true" /> Find a bin</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* LIVE STATS */}
      <section aria-labelledby="impact-title" className="max-w-6xl mx-auto px-4 -mt-6 sm:-mt-10 pb-16">
        <h2 id="impact-title" className="sr-only">Live impact</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <StatCard
            icon={Recycle} tint="bg-green-100 text-green-700"
            value={show(s => formatCount(s.items))} label="Items recycled"
            note={show(s => `~${formatKg(s.wasteKg)} diverted from landfill`)}
          />
          <StatCard
            icon={Wallet} tint="bg-blue-100 text-blue-700"
            value={show(s => formatInr(s.rewardsIssued))} label="Rewards earned"
            note={show(s => `by ${formatCount(s.users)} eco-warrior${s.users === 1 ? '' : 's'}`)}
          />
          <StatCard
            icon={TreePine} tint="bg-amber-100 text-amber-700"
            value={show(s => formatCo2(s.co2Kg))} label="CO₂ saved (est.)"
            note={show(s => `${s.activeBins} of ${s.bins} smart bins active`)}
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section aria-labelledby="how-title" className="bg-green-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 sm:py-20">
          <h2 id="how-title" className="text-3xl font-extrabold text-center mb-12">How it works</h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map(({ icon, title, text }, i) => {
              const StepIcon = icon;
              return (
              <li key={title} className="rounded-2xl bg-white/5 border border-white/10 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-10 h-10 rounded-full bg-green-500 text-green-950 font-extrabold flex items-center justify-center">{i + 1}</span>
                  <StepIcon className="text-green-300" aria-hidden="true" />
                </div>
                <h3 className="text-xl font-bold mb-2">{title}</h3>
                <p className="text-green-100/90">{text}</p>
              </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* CTA */}
      {!session && (
        <section className="max-w-6xl mx-auto px-4 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Ready to make your first deposit?</h2>
          <p className="text-gray-600 mt-2 mb-8">It takes less than a minute to sign up.</p>
          <Link to="/register" className={primary}>Join {BRAND_NAME} <ArrowRight size={20} aria-hidden="true" /></Link>
        </section>
      )}
    </AppShell>
  );
}
