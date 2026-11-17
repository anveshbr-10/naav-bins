import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiErrorMessage, apiStatus } from './api';
import { useAuth } from './authContext';
import RedeemModal from './redeemModal';
import { formatCo2, formatDateTime } from './format';
import {
  Wallet, Leaf, LogOut, History, Ticket, Bus, Train, Trophy, MapPin, ScanQrCode, Gift,
  Receipt, RefreshCw, Loader2, TreePine, WifiOff,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const WASTE_TYPES = [
  { name: 'Plastic',           color: '#F59E0B', emoji: '🧴' },
  { name: 'Metal',             color: '#94A3B8', emoji: '🔩' },
  { name: 'Paper / Cardboard', color: '#92400E', emoji: '📦' },
  { name: 'Organic',           color: '#16A34A', emoji: '🌿' },
  { name: 'Glass',             color: '#0891B2', emoji: '🫙' },
  { name: 'Other Trash',       color: '#DC2626', emoji: '🗑️' },
];
const wasteColorMap = Object.fromEntries(WASTE_TYPES.map(w => [w.name, w.color]));
const wasteEmojiMap = Object.fromEntries(WASTE_TYPES.map(w => [w.name, w.emoji]));

// Visual style per redeemable item (amounts and descriptions come from the server catalogue).
const ITEM_STYLE = {
  'Movie Voucher':  { Icon: Ticket, bg: 'bg-purple-100', fg: 'text-purple-600' },
  'Bus Pass':       { Icon: Bus,    bg: 'bg-yellow-100', fg: 'text-yellow-600' },
  'Metro Recharge': { Icon: Train,  bg: 'bg-indigo-100', fg: 'text-indigo-600' },
};
const DEFAULT_ITEM_STYLE = { Icon: Gift, bg: 'bg-emerald-100', fg: 'text-emerald-600' };

const STATUS_STYLE = {
  Issued:  'bg-green-100 text-green-700 border-green-200',
  Pending: 'bg-amber-100 text-amber-700 border-amber-200',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [impact, setImpact] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error | missing
  const [loadError, setLoadError] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [redeemEntry, setRedeemEntry] = useState(null);

  const { signOut } = useAuth();
  const goToLogin = useCallback(async () => { await signOut(); navigate('/login', { replace: true }); }, [signOut, navigate]);

  // Only an authentication failure logs the user out; network/server errors show a retry screen.
  const fetchUserData = useCallback(() => api.get('/api/dashboard')
    .then((res) => {
      setUser(res.data.user);
      setImpact(res.data.impact || null);
      setLoadState('ready');
    })
    .catch((err) => {
      const code = apiStatus(err);
      if (code === 401) { goToLogin(); return; }
      if (code === 404) { setLoadState('missing'); return; }
      setLoadError(apiErrorMessage(err, 'Could not load your dashboard.'));
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

  const retry = () => {
    setLoadState('loading');
    fetchUserData();
    if (!catalog) fetchCatalog();
  };

  // ---------- Loading / error screens ----------
  if (loadState === 'loading') {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-3 text-gray-600">
        <Loader2 className="animate-spin text-green-600" size={40} />
        <p className="font-bold text-xl">Loading Dashboard...</p>
        <p className="text-sm text-gray-400">The server may take up to 30 seconds to wake up.</p>
      </div>
    );
  }

  if (loadState === 'error' || loadState === 'missing') {
    const missing = loadState === 'missing';
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4 p-6 text-center">
        <WifiOff className="text-gray-400" size={48} />
        <h1 className="text-2xl font-bold text-gray-800">{missing ? 'Profile not found' : 'Could not load your dashboard'}</h1>
        <p className="text-gray-500 max-w-md">
          {missing
            ? 'Your login works, but your rewards profile is missing. Please contact support from the About page.'
            : `${loadError} Check your connection and try again.`}
        </p>
        <div className="flex gap-3">
          {!missing && (
            <button onClick={retry} className="flex items-center gap-2 bg-green-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-700">
              <RefreshCw size={18} /> Try again
            </button>
          )}
          <button onClick={goToLogin} className="flex items-center gap-2 bg-gray-100 text-gray-700 px-5 py-3 rounded-xl font-bold hover:bg-gray-200">
            <LogOut size={18} /> Log out
          </button>
        </div>
      </div>
    );
  }

  // ---------- Derived data ----------
  const logs = Array.isArray(user.logs) ? user.logs : [];
  const redemptions = Array.isArray(user.redemptions) ? user.redemptions : [];

  const earningsData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateString = d.toDateString();
    const dailyTotal = logs
      .filter(log => new Date(log.date).toDateString() === dateString)
      .reduce((sum, log) => sum + (log.amount || 0), 0);
    earningsData.push({ name: d.toLocaleDateString('en-US', { weekday: 'short' }), earnings: dailyTotal });
  }

  const pieData = WASTE_TYPES
    .map(w => ({ name: w.name, color: w.color, value: logs.filter(l => l.wasteType === w.name).length }))
    .filter(d => d.value > 0);

  const rewardByType = Object.fromEntries((catalog?.rewards || []).map(r => [r.wasteType, r]));
  const vouchers = (catalog?.redeem || []).filter(r => r.type === 'points');
  const withdrawal = (catalog?.redeem || []).find(r => r.type === 'money');

  return (
    <div className="min-h-screen bg-gray-50 p-8">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 bg-white p-6 rounded-2xl shadow-sm gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Hello, {user.name}!</h1>
          <p className="text-gray-500">Your Impact & Rewards Dashboard</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => navigate('/leaderboard')}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-yellow-50 text-yellow-600 px-5 py-3 rounded-xl font-bold hover:bg-yellow-100 transition border border-yellow-200"
          >
            <Trophy size={20} /> <span className="hidden sm:inline">Leaderboard</span>
          </button>
          <button
            onClick={async () => { await signOut(); navigate('/'); }}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-red-50 text-red-600 px-5 py-3 rounded-xl font-bold hover:bg-red-100 transition"
          >
            <LogOut size={20} /> <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">Wallet Balance</h2>
            <p className="text-4xl font-bold text-green-600">₹{user.walletBalance ?? 0}</p>
            {withdrawal && (
              <button
                onClick={() => setRedeemEntry(withdrawal)}
                className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded mt-2 font-bold hover:bg-green-200"
              >
                Withdraw ₹{withdrawal.cost} to UPI
              </button>
            )}
          </div>
          <Wallet className="text-green-600" size={40} />
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">Eco Points</h2>
            <p className="text-4xl font-bold text-blue-600">{user.ecoPoints ?? 0}</p>
            <p className="text-xs text-blue-400 mt-1">Redeem below</p>
          </div>
          <Leaf className="text-blue-600" size={40} />
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-gray-400 font-medium">CO₂ Saved <span className="text-xs">(est.)</span></h2>
            <p className="text-4xl font-bold text-yellow-600">{formatCo2(impact?.co2Kg)}</p>
            <p className="text-xs text-gray-400 mt-1">
              {impact?.items ?? logs.length} items · ~{impact?.wasteKg ?? 0} kg recycled
            </p>
          </div>
          <TreePine className="text-yellow-600" size={40} />
        </div>
      </div>

      {/* PRIMARY ACTIONS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => navigate('/scan')}
          className="bg-gradient-to-r from-green-600 to-emerald-600 text-white w-full py-5 text-xl rounded-2xl shadow-lg hover:shadow-xl hover:scale-[1.01] transition transform font-bold flex items-center justify-center gap-3"
        >
          <ScanQrCode /> Scan a Bin
        </button>
        <button
          onClick={() => navigate('/map')}
          className="bg-white text-green-700 border-2 border-green-600 w-full py-5 text-xl rounded-2xl shadow-sm hover:bg-green-50 transition font-bold flex items-center justify-center gap-3"
        >
          🗺️ Find Nearby Bins
        </button>
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
          <h3 className="text-lg font-bold mb-4 text-gray-700">Earnings Trend</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={earningsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(value) => [`₹${value}`, 'Earnings']} />
              <Line type="monotone" dataKey="earnings" stroke="#16a34a" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80 flex flex-col">
          <h3 className="text-lg font-bold mb-4 text-gray-700">Waste Distribution</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value">
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} item${value === 1 ? '' : 's'}`, name]} />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 gap-2">
              <span className="text-4xl">♻️</span>
              <p>No items recycled yet.</p>
              <p className="text-sm">Scan a bin and deposit your first item to see your mix here.</p>
            </div>
          )}
        </div>
      </div>

      {/* WASTE TYPE LEGEND CARDS */}
      <div className="mb-10">
        <h3 className="text-lg font-bold mb-4 text-gray-700">Waste & Reward Guide</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {WASTE_TYPES.map(w => {
            const r = rewardByType[w.name];
            return (
              <div key={w.name} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: `${w.color}18`, border: `1px solid ${w.color}44` }}
                >
                  {w.emoji}
                </div>
                <div>
                  <p className="font-semibold text-gray-800 text-sm leading-tight">{w.name}</p>
                  <p className="text-xs font-bold mt-0.5" style={{ color: w.color }}>
                    {r ? `+₹${r.reward} · +${r.points} pts per item` : catalogFailed ? 'Reward unavailable' : 'Loading…'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* REWARDS SHOP */}
      <div className="mb-10">
        <h3 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2">
          <Ticket className="text-blue-600" /> Redeem Eco Points
        </h3>
        {catalogFailed && !catalog ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center text-gray-500">
            Could not load rewards.{' '}
            <button onClick={fetchCatalog} className="text-green-700 font-bold underline">Retry</button>
          </div>
        ) : !catalog ? (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={18} /> Loading rewards…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {vouchers.map(v => {
              const { Icon, bg, fg } = ITEM_STYLE[v.item] || DEFAULT_ITEM_STYLE;
              const affordable = (user.ecoPoints ?? 0) >= v.cost;
              return (
                <div key={v.item} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition">
                  <div className={`${bg} w-12 h-12 rounded-full flex items-center justify-center mb-4`}><Icon className={fg} /></div>
                  <h4 className="text-xl font-bold">{v.item}</h4>
                  <p className="text-gray-500 text-sm mb-4">{v.description}</p>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-blue-600">{v.cost} Pts</span>
                    <button
                      onClick={() => setRedeemEntry(v)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold ${affordable ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400'}`}
                    >
                      {affordable ? 'Redeem' : `Need ${v.cost - (user.ecoPoints ?? 0)} more`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* REDEMPTION HISTORY */}
      <div className="mb-10">
        <h3 className="text-xl font-bold mb-4 text-gray-700 flex items-center gap-2"><Receipt /> Redemption History</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {redemptions.length > 0 ? (
            redemptions.slice().reverse().slice(0, 10).map((r, i) => (
              <div key={r.code || `${r.date}-${i}`} className="p-4 border-b last:border-0 flex justify-between items-center gap-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800">{r.type === 'money' ? 'UPI Withdrawal' : r.item}</p>
                  <p className="text-xs text-gray-500">{formatDateTime(r.date)}</p>
                  {r.code && <p className="text-xs font-mono text-gray-600 mt-1">Code: {r.code}{r.upiId ? ` · to ${r.upiId}` : ''}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="font-bold text-gray-700">{r.type === 'money' ? `-₹${r.cost}` : `-${r.cost} pts`}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {r.status || 'Completed'}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-gray-400">No redemptions yet. Your vouchers and withdrawals will appear here.</div>
          )}
        </div>
      </div>

      {/* RECENT ACTIVITY */}
      <div className="mt-8">
        <h3 className="text-xl font-bold mb-4 text-gray-700 flex items-center gap-2"><History /> Recent Activity</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {logs.length > 0 ? (
            logs.slice().reverse().slice(0, 5).map((log, i) => {
              const wColor = wasteColorMap[log.wasteType] || '#6B7280';
              const wEmoji = wasteEmojiMap[log.wasteType] || '♻️';
              return (
                <div key={log.session || `${log.date}-${i}`} className="p-4 border-b last:border-0 flex justify-between items-center hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: `${wColor}18`, border: `1px solid ${wColor}44` }}
                    >
                      {wEmoji}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800" style={{ color: wColor }}>{log.wasteType}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(log.date)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-green-600 font-bold">+₹{log.amount}</span>
                    <div className="hidden sm:block">
                      <p className="text-emerald-600 text-xs font-bold flex items-center gap-1 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
                        <MapPin size={12} /> {log.location || "Unknown Location"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-center text-gray-400">No activity yet. Scan some items to see data!</div>
          )}
        </div>
      </div>

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
  );
}
