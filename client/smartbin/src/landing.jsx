import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Recycle, ArrowRight, Wallet, TreePine, Sparkles, ScanLine, ArrowUpRight } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col font-sans selection:bg-emerald-500/30 relative">

      {/* --- BACKGROUND GLOW EFFECTS (LOCKED IN A CONTAINER) --- */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-600/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[30%] h-[30%] bg-blue-600/10 blur-[100px] rounded-full" />
      </div>

      {/* 1. NAVBAR (Glassmorphism) */}
      <nav className="flex justify-between items-center p-6 px-6 md:px-12 sticky top-0 z-50 bg-slate-950/60 backdrop-blur-xl border-b border-slate-800/50">
        <div
          onClick={() => navigate('/')}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="bg-emerald-500/10 p-2 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
            <Recycle className="w-7 h-7 text-emerald-400 group-hover:rotate-180 transition-transform duration-700 ease-in-out" />
          </div>
          <span className="text-2xl font-black tracking-tight text-white flex items-center gap-1">
            Smart<span className="text-emerald-500">Bin</span>
          </span>
        </div>

        <div className="hidden md:flex space-x-8 items-center">
          <button onClick={() => navigate('/about')} className="text-slate-400 font-medium hover:text-white transition-colors">
            About
          </button>
          <button onClick={() => navigate('/login')} className="text-slate-400 font-medium hover:text-white transition-colors">
            Login
          </button>
          <button
            onClick={() => navigate('/register')}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-6 py-2.5 rounded-full font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:-translate-y-0.5"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* 2. HERO SECTION */}
      <header className="flex-1 flex flex-col items-center justify-center text-center px-4 pt-24 pb-16 relative z-10">
        <div className="max-w-4xl mx-auto flex flex-col items-center">

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700 text-emerald-400 text-sm font-semibold mb-8 backdrop-blur-sm animate-fade-in-up">
            <Sparkles size={16} /> Welcome to the future of waste management
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-white leading-[1.1] mb-6 tracking-tight">
            Turn Trash into <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              Digital Wealth.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Scan your waste. Dispose responsibly. Earn instant cash and eco-points. Join the network of smart bins making cities cleaner and greener.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center w-full sm:w-auto">
            <button
              onClick={() => navigate('/register')}
              className="group flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 px-8 py-4 rounded-full text-lg font-bold hover:bg-emerald-400 transition-all shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_40px_rgba(16,185,129,0.5)] hover:-translate-y-1"
            >
              Register Now <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="flex items-center justify-center gap-2 bg-slate-800/50 border border-slate-700 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-slate-700 transition-all hover:-translate-y-1 backdrop-blur-sm"
            >
              Account Login
            </button>
          </div>
        </div>
      </header>

      {/* 3. STATS SECTION (Floating Glass Cards) */}
      <section className="py-20 relative z-10">
        <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-6">

          <div className="group p-8 rounded-3xl bg-slate-900/50 border border-slate-800 hover:border-emerald-500/30 transition-all duration-300 hover:bg-slate-800/50 backdrop-blur-md">
            <div className="bg-emerald-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <Recycle className="text-emerald-400 w-7 h-7" />
            </div>
            <h3 className="text-4xl font-black text-white mb-1">120 <span className="text-2xl text-emerald-500 font-bold">kg</span></h3>
            <p className="text-slate-400 font-medium">Waste Collected & Recycled</p>
          </div>

          <div className="group p-8 rounded-3xl bg-slate-900/50 border border-slate-800 hover:border-blue-500/30 transition-all duration-300 hover:bg-slate-800/50 backdrop-blur-md">
            <div className="bg-blue-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <Wallet className="text-blue-400 w-7 h-7" />
            </div>
            <h3 className="text-4xl font-black text-white mb-1">₹8,456</h3>
            <p className="text-slate-400 font-medium">Rewards Distributed</p>
          </div>

          <div className="group p-8 rounded-3xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/30 transition-all duration-300 hover:bg-slate-800/50 backdrop-blur-md">
            <div className="bg-cyan-500/10 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <TreePine className="text-cyan-400 w-7 h-7" />
            </div>
            <h3 className="text-4xl font-black text-white mb-1">2,341 <span className="text-2xl text-cyan-500 font-bold">kg</span></h3>
            <p className="text-slate-400 font-medium">Carbon Emissions Saved</p>
          </div>

        </div>
      </section>

      {/* 4. HOW IT WORKS (Minimal & Sleek) */}
      <section className="py-24 relative z-10 border-t border-slate-800/50 bg-slate-950/50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">How SmartBin Works</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Three simple steps to make an environmental impact and earn rewards.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center relative">

            {/* Step 1 */}
            <div className="relative group">
              <div className="bg-slate-900 border border-slate-700 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:border-emerald-500 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all duration-300">
                <ScanLine className="text-emerald-400 w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">1. Scan QR Code</h3>
              <p className="text-slate-400 leading-relaxed">Locate a nearby Smart Bin on your map and scan the QR code to connect your wallet.</p>
            </div>

            {/* Step 2 */}
            <div className="relative group">
              <div className="bg-slate-900 border border-slate-700 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:border-blue-500 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300">
                <Recycle className="text-blue-400 w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">2. Dispose Waste</h3>
              <p className="text-slate-400 leading-relaxed">Drop your items inside. Our embedded AI automatically verifies the material type and weight.</p>
            </div>

            {/* Step 3 */}
            <div className="relative group">
              <div className="bg-slate-900 border border-slate-700 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:border-cyan-500 group-hover:shadow-[0_0_20px_rgba(6,182,212,0.2)] transition-all duration-300">
                <ArrowUpRight className="text-cyan-400 w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">3. Earn Rewards</h3>
              <p className="text-slate-400 leading-relaxed">Get rupees and eco-points deposited instantly into your digital wallet to redeem.</p>
            </div>

          </div>
        </div>
      </section>

    </div>
  );
}