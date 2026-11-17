import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './authContext';
import useImpactStats from './useImpactStats';
import { formatCo2, formatCount, formatInr, formatKg } from './format';
import { Recycle, ArrowRight, Wallet, Leaf, TreePine } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const { status, home } = useAuth();
  const session = status === 'signedIn';
  const { status: statsStatus, stats } = useImpactStats();
  const show = (fn) => (statsStatus === 'ready' ? fn(stats) : statsStatus === 'loading' ? '…' : '—');
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* 1. NAVBAR */}
      <nav className="flex justify-between items-center p-6 px-10 shadow-sm bg-white z-50">
        {/* Logo now goes back to Home (Standard Web Practice) */}
        <div
          onClick={() => navigate('/')}
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition"
        >
          <Recycle className="w-8 h-8 text-green-600" />
          <span className="text-2xl font-bold text-gray-800 tracking-tight">SmartBin</span>
        </div>
        {/* Buttons Section */}
        <div className="space-x-6 flex items-center">
          {/* NEW: Clear explicit About link */}
          <button
            onClick={() => navigate('/about')}
            className="text-gray-600 font-medium hover:text-green-600 transition"
          >
            About
          </button>
          {session ? (
            <button
              onClick={() => navigate(home)}
              className="bg-green-600 text-white px-6 py-2 rounded-full font-semibold hover:bg-green-700 transition shadow-lg"
            >
              Go to Dashboard
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/login')}
                className="text-gray-600 font-medium hover:text-green-600 transition"
              >
                Login
              </button>
              <button
                onClick={() => navigate('/register')}
                className="bg-green-600 text-white px-6 py-2 rounded-full font-semibold hover:bg-green-700 transition shadow-lg"
              >
                Register
              </button>
            </>
          )}
        </div>
      </nav>
      {/* 2. HERO SECTION */}
      <header className="flex-1 flex flex-col items-center justify-center text-center px-4 bg-gradient-to-b from-green-50 to-white">
        <div className="max-w-4xl">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
            Turn Trash into Cash <br />
            <span className="text-green-600">Earn by Keeping Your City Clean!</span>
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            Scan. Dispose. Earn. A smarter way to manage waste sustainably. Join your campus community in keeping it clean.
          </p>
          {session ? (
            <div className="flex justify-center">
              <button
                onClick={() => navigate(home)}
                className="flex items-center justify-center gap-2 bg-green-600 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-green-700 transition shadow-xl transform hover:scale-105"
              >
                Go to Dashboard <ArrowRight size={20} />
              </button>
            </div>
          ) : (
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/register')}
              className="flex items-center justify-center gap-2 bg-green-600 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-green-700 transition shadow-xl transform hover:scale-105"
            >
              Register Now <ArrowRight size={20} />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="bg-white text-green-600 border-2 border-green-600 px-8 py-4 rounded-full text-lg font-bold hover:bg-green-50 transition"
            >
              Login
            </button>
          </div>
          )}
        </div>
      </header>
      {/* 3. STATS SECTION (From the video) */}
      <section className="bg-white py-16">
        <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Stat 1 */}
          <div className="p-8 rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-center border-b-4 border-green-500">
            <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Recycle className="text-green-600 w-8 h-8" />
            </div>
            <h3 className="text-4xl font-bold text-gray-800 mb-2">{show(s => formatCount(s.items))}</h3>
            <p className="text-gray-500 font-medium">Items Recycled</p>
            <p className="text-xs text-gray-400 mt-1">{show(s => `~${formatKg(s.wasteKg)} diverted from landfill`)}</p>
          </div>
          {/* Stat 2 */}
          <div className="p-8 rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-center border-b-4 border-blue-500">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Wallet className="text-blue-600 w-8 h-8" />
            </div>
            <h3 className="text-4xl font-bold text-gray-800 mb-2">{show(s => formatInr(s.rewardsIssued))}</h3>
            <p className="text-gray-500 font-medium">Rewards Earned</p>
            <p className="text-xs text-gray-400 mt-1">{show(s => `by ${formatCount(s.users)} eco-warrior${s.users === 1 ? '' : 's'}`)}</p>
          </div>
          {/* Stat 3 */}
          <div className="p-8 rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] text-center border-b-4 border-yellow-500">
            <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <TreePine className="text-yellow-600 w-8 h-8" />
            </div>
            <h3 className="text-4xl font-bold text-gray-800 mb-2">{show(s => formatCo2(s.co2Kg))}</h3>
            <p className="text-gray-500 font-medium">CO₂ Saved (est.)</p>
            <p className="text-xs text-gray-400 mt-1">{show(s => `${s.activeBins} of ${s.bins} smart bins active`)}</p>
          </div>
        </div>
      </section>
      {/* 4. HOW IT WORKS */}
      <section className="bg-green-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div>
              <div className="bg-green-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold">1</div>
              <h3 className="text-xl font-bold mb-2">Scan the Bin</h3>
              <p className="text-green-200">Find a Smart Bin on the map and scan its QR code to start a session.</p>
            </div>
            <div>
              <div className="bg-green-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold">2</div>
              <h3 className="text-xl font-bold mb-2">Show &amp; Dispose</h3>
              <p className="text-green-200">Show the item to your camera. Our AI identifies the material and tells you which bin to use.</p>
            </div>
            <div>
              <div className="bg-green-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold">3</div>
              <h3 className="text-xl font-bold mb-2">Earn Rewards</h3>
              <p className="text-green-200">Money and Eco-Points land in your wallet instantly, ready to redeem.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}