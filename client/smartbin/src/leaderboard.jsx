import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Medal, Award, ArrowLeft, Loader2, Crown, RefreshCw, WifiOff } from 'lucide-react';
import api, { getSession } from './api';

// Standard competition ranking: equal points share a rank (1, 2, 2, 4).
function withRanks(list) {
    let rank = 0;
    return list.map((entry, i) => {
        if (i === 0 || entry.ecoPoints !== list[i - 1].ecoPoints) rank = i + 1;
        return { ...entry, rank };
    });
}

const PODIUM_STYLE = [
    { // 1st
        card: 'bg-gradient-to-b from-yellow-50 to-white p-6 rounded-t-2xl shadow-2xl border-t-4 border-yellow-400 relative z-10',
        icon: <Crown className="w-12 h-12 mx-auto text-yellow-500 mb-2 -mt-8 bg-white rounded-full p-1 shadow-sm" />,
        name: 'font-bold text-slate-800 text-lg truncate',
        points: 'text-emerald-600 font-black text-xl',
    },
    { // 2nd
        card: 'bg-white p-4 rounded-t-2xl rounded-bl-2xl shadow-lg border-t-4 border-gray-300 transform translate-y-4',
        icon: <Medal className="w-10 h-10 mx-auto text-gray-400 mb-2" />,
        name: 'font-bold text-slate-800 truncate',
        points: 'text-emerald-600 font-extrabold',
    },
    { // 3rd
        card: 'bg-white p-4 rounded-t-2xl rounded-br-2xl shadow-lg border-t-4 border-amber-600 transform translate-y-8',
        icon: <Award className="w-10 h-10 mx-auto text-amber-600 mb-2" />,
        name: 'font-bold text-slate-800 truncate',
        points: 'text-emerald-600 font-extrabold',
    },
];

export default function Leaderboard() {
    const [leaders, setLeaders] = useState([]);
    const [loadState, setLoadState] = useState('loading'); // loading | ready | error
    const navigate = useNavigate();
    const session = getSession();

    const fetchLeaderboard = useCallback(() => api.get('/api/leaderboard')
        .then((res) => {
            setLeaders(withRanks(Array.isArray(res.data.leaderboard) ? res.data.leaderboard : []));
            setLoadState('ready');
        })
        .catch(() => setLoadState('error')), []);

    useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

    const retry = () => { setLoadState('loading'); fetchLeaderboard(); };

    // Podium shows whoever exists (1, 2 or 3 people) in the classic 2-1-3 order.
    const podium = [1, 0, 2].filter(i => leaders[i]).map(i => ({ ...leaders[i], style: PODIUM_STYLE[i] }));
    const rest = leaders.slice(3);

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-16">

            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-600 to-green-800 text-white pt-12 pb-24 px-4 text-center rounded-b-[3rem] shadow-xl relative">
                <button
                    onClick={() => navigate(session ? '/dashboard' : '/')}
                    aria-label="Back"
                    className="absolute top-6 left-6 p-2 bg-white/20 rounded-full hover:bg-white/30 transition backdrop-blur-sm"
                >
                    <ArrowLeft size={24} />
                </button>
                <Trophy className="w-16 h-16 mx-auto mb-4 text-yellow-300" />
                <h1 className="text-4xl font-extrabold mb-2">Global Leaderboard</h1>
                <p className="text-emerald-100 opacity-90">Top Eco-Warriors making a difference</p>
            </div>

            {loadState === 'loading' && (
                <div className="flex flex-col items-center justify-center mt-20">
                    <Loader2 className="animate-spin w-12 h-12 text-emerald-500 mb-4" />
                    <p className="text-slate-500 font-medium">Ranking players...</p>
                </div>
            )}

            {loadState === 'error' && (
                <div className="max-w-md mx-auto px-4 -mt-12 relative z-10">
                    <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
                        <WifiOff className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                        <p className="font-bold text-slate-800">Could not load the leaderboard</p>
                        <p className="text-sm text-slate-500 mt-1">The server may be waking up. Please try again.</p>
                        <button onClick={retry} className="mt-5 inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700">
                            <RefreshCw size={16} /> Try again
                        </button>
                    </div>
                </div>
            )}

            {loadState === 'ready' && (
                <div className="max-w-3xl mx-auto px-4 -mt-16 relative z-10">

                    {leaders.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-lg p-10 text-center">
                            <p className="text-4xl mb-3">🌱</p>
                            <p className="font-bold text-slate-800 text-lg">No one is on the board yet</p>
                            <p className="text-slate-500 mt-1">Recycle your first item to claim the top spot.</p>
                            <button
                                onClick={() => navigate(session ? '/scan' : '/register')}
                                className="mt-6 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700"
                            >
                                {session ? 'Scan a Bin' : 'Join Now'}
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Podium (1–3 people) */}
                            <div className={`grid gap-4 mb-8 items-end ${podium.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' : podium.length === 2 ? 'grid-cols-2 max-w-lg mx-auto' : 'grid-cols-3'}`}>
                                {podium.map((p, i) => (
                                    <div key={`${p.rank}-${p.name}-${i}`} className={`${p.style.card} text-center`}>
                                        {p.style.icon}
                                        <p className="text-xs font-bold text-slate-400">#{p.rank}</p>
                                        <h3 className={p.style.name}>{p.name}</h3>
                                        <p className={p.style.points}>{p.ecoPoints} pts</p>
                                    </div>
                                ))}
                            </div>

                            {/* Ranks 4+ */}
                            {rest.length > 0 ? (
                                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                    {rest.map((user, index) => (
                                        <div
                                            key={`${user.rank}-${user.name}-${index}`}
                                            className="flex items-center justify-between p-5 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"
                                        >
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 flex-shrink-0">
                                                    #{user.rank}
                                                </div>
                                                <span className="font-bold text-slate-700 truncate">{user.name}</span>
                                            </div>
                                            <div className="font-extrabold text-emerald-600 flex-shrink-0">
                                                {user.ecoPoints} <span className="text-xs text-emerald-400 font-medium">pts</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center text-slate-500">
                                    More eco-warriors needed to fill the ranks!
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
