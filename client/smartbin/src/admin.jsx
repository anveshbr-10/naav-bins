import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Users, Search, Wallet, Leaf, ArrowUpRight, Download, LogOut, ShieldCheck, Loader2, RefreshCw,
    X, Landmark, Ticket, AlertTriangle, Recycle, WifiOff,
} from 'lucide-react';
import api, { apiErrorMessage, apiStatus, logout } from './api';
import { formatCo2, formatCount, formatDate, formatDateTime, formatInr } from './format';

const STATUS_BADGE = {
    Issued:    'bg-green-100 text-green-700 border-green-200',
    Pending:   'bg-amber-100 text-amber-700 border-amber-200',
    Paid:      'bg-blue-100 text-blue-700 border-blue-200',
    Claimed:   'bg-slate-100 text-slate-700 border-slate-200',
    Rejected:  'bg-red-100 text-red-700 border-red-200',
    Cancelled: 'bg-red-100 text-red-700 border-red-200',
};

// Which admin actions apply to a redemption (mirrors the server's allowed transitions).
function actionsFor(r) {
    if (!r || !r.code) return [];
    if (r.type === 'money' && r.status === 'Pending') {
        return [{ status: 'Paid', label: 'Mark paid', tone: 'primary' }, { status: 'Rejected', label: 'Reject & refund', tone: 'danger' }];
    }
    if (r.type === 'points' && r.status === 'Issued') {
        return [{ status: 'Claimed', label: 'Mark claimed', tone: 'primary' }, { status: 'Cancelled', label: 'Cancel & refund', tone: 'danger' }];
    }
    return [];
}

function sumLogs(logs) {
    return (Array.isArray(logs) ? logs : []).reduce((s, l) => s + (Number(l && l.amount) || 0), 0);
}

// CSV cell: quote everything and neutralise spreadsheet formulas (CSV injection).
function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}

function StatusBadge({ status }) {
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {status || 'Completed'}
        </span>
    );
}

// Two-step button group: pick an action, then confirm it inline.
function RedemptionActions({ email, redemption, busyKey, confirming, onAsk, onConfirm, onCancel }) {
    const actions = actionsFor(redemption);
    if (!actions.length) return null;
    const key = `${email}|${redemption.code}`;
    const busy = busyKey === key;

    if (confirming && confirming.key === key) {
        const action = actions.find(a => a.status === confirming.status);
        return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-xs text-slate-500">{action.label}?</span>
                <button
                    onClick={onConfirm}
                    disabled={busy}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 ${action.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-60`}
                >
                    {busy && <Loader2 size={12} className="animate-spin" />} Confirm
                </button>
                <button onClick={onCancel} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200">
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 flex-wrap justify-end">
            {actions.map(a => (
                <button
                    key={a.status}
                    onClick={() => onAsk({ key, email, code: redemption.code, status: a.status })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${a.tone === 'danger'
                        ? 'border-red-200 text-red-600 hover:bg-red-50'
                        : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
                >
                    {a.label}
                </button>
            ))}
        </div>
    );
}

export default function Admin() {
    const navigate = useNavigate();
    const [users, setUsers] = useState([]);
    const [missingProfiles, setMissingProfiles] = useState([]);
    const [loadState, setLoadState] = useState('loading'); // loading | ready | error
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [busyKey, setBusyKey] = useState(null);
    const [actionError, setActionError] = useState(null);

    const handleAuthError = useCallback((err) => {
        const status = apiStatus(err);
        if (status === 401) { logout(); navigate('/login', { replace: true }); return true; }
        if (status === 403) { navigate('/dashboard', { replace: true }); return true; }
        return false;
    }, [navigate]);

    const fetchUsers = useCallback(() => api.get('/api/admin/users')
        .then((res) => {
            setUsers(Array.isArray(res.data.users) ? res.data.users : []);
            setMissingProfiles(Array.isArray(res.data.missingProfiles) ? res.data.missingProfiles : []);
            setLoadState('ready');
        })
        .catch((err) => { if (!handleAuthError(err)) setLoadState('error'); }), [handleAuthError]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const retry = () => { setLoadState('loading'); fetchUsers(); };

    const applyAction = async () => {
        if (!confirming) return;
        setBusyKey(confirming.key);
        setActionError(null);
        try {
            await api.post('/api/admin/redemptions/status', {
                email: confirming.email, code: confirming.code, status: confirming.status,
            });
            setConfirming(null);
            await fetchUsers();
        } catch (err) {
            if (!handleAuthError(err)) setActionError(apiErrorMessage(err, 'Could not update the redemption.'));
        } finally {
            setBusyKey(null);
        }
    };

    // ---------- Derived data ----------
    const stats = useMemo(() => {
        let rewardsIssued = 0, items = 0, co2Kg = 0, paidOut = 0, pendingAmount = 0, pendingCount = 0, walletTotal = 0;
        for (const u of users) {
            rewardsIssued += sumLogs(u.logs);
            items += u.impact?.items || 0;
            co2Kg += u.impact?.co2Kg || 0;
            walletTotal += Number(u.walletBalance) || 0;
            for (const r of Array.isArray(u.redemptions) ? u.redemptions : []) {
                if (r.type !== 'money') continue;
                if (r.status === 'Paid') paidOut += Number(r.cost) || 0;
                if (r.status === 'Pending') { pendingAmount += Number(r.cost) || 0; pendingCount += 1; }
            }
        }
        return { rewardsIssued, items, co2Kg, paidOut, pendingAmount, pendingCount, walletTotal };
    }, [users]);

    const queue = useMemo(() => users.flatMap(u => (Array.isArray(u.redemptions) ? u.redemptions : [])
        .filter(r => actionsFor(r).length)
        .map(r => ({ user: u, redemption: r })))
        .sort((a, b) => (a.redemption.type === b.redemption.type ? 0 : a.redemption.type === 'money' ? -1 : 1)
            || String(a.redemption.date).localeCompare(String(b.redemption.date))), [users]);

    const term = searchTerm.trim().toLowerCase();
    const filteredUsers = users.filter(u =>
        String(u.name || '').toLowerCase().includes(term) || String(u.email || '').toLowerCase().includes(term));

    const selectedUser = users.find(u => u.email === selectedEmail) || null;
    const orphanProfiles = users.filter(u => u.hasLogin === false);

    const exportCsv = () => {
        const header = ['Name', 'Email', 'Role', 'Joined', 'Wallet (INR)', 'Eco Points', 'Items Recycled', 'Est. CO2 (kg)', 'Rewards Earned (INR)', 'Pending Withdrawals (INR)'];
        const rows = filteredUsers.map(u => [
            u.name, u.email, u.role, u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '',
            u.walletBalance ?? 0, u.ecoPoints ?? 0, u.impact?.items ?? 0, u.impact?.co2Kg ?? 0, sumLogs(u.logs),
            (Array.isArray(u.redemptions) ? u.redemptions : []).filter(r => r.type === 'money' && r.status === 'Pending')
                .reduce((s, r) => s + (Number(r.cost) || 0), 0),
        ]);
        const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `naav-bins-users-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const actionProps = {
        busyKey, confirming,
        onAsk: (c) => { setActionError(null); setConfirming(c); },
        onConfirm: applyAction,
        onCancel: () => setConfirming(null),
    };

    // ---------- Render ----------
    return (
        <div className="min-h-screen bg-slate-50">

            {/* TOP NAVIGATION */}
            <nav className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex justify-between items-center sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-lg">
                        <ShieldCheck className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">Admin Portal</h1>
                        <p className="text-xs text-slate-500">SmartBin Developer Console</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={retry} aria-label="Refresh" className="text-slate-500 hover:text-indigo-600 transition">
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => { logout(); navigate('/'); }}
                        className="flex items-center gap-2 text-slate-500 hover:text-red-600 transition font-medium"
                    >
                        <LogOut size={18} /> Logout
                    </button>
                </div>
            </nav>

            {loadState === 'loading' && (
                <div className="flex flex-col items-center justify-center py-32 text-slate-500 gap-3">
                    <Loader2 className="animate-spin text-indigo-600" size={36} />
                    <p className="font-medium">Loading users…</p>
                </div>
            )}

            {loadState === 'error' && (
                <div className="flex flex-col items-center justify-center py-32 text-center gap-3 px-4">
                    <WifiOff className="text-slate-400" size={40} />
                    <p className="font-bold text-slate-800">Could not load admin data</p>
                    <p className="text-sm text-slate-500">The server may be waking up. Please try again.</p>
                    <button onClick={retry} className="mt-2 inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700">
                        <RefreshCw size={16} /> Try again
                    </button>
                </div>
            )}

            {loadState === 'ready' && (
                <div className="p-4 md:p-8 max-w-7xl mx-auto">

                    {missingProfiles.length > 0 && (
                        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 flex gap-3">
                            <AlertTriangle className="flex-shrink-0 mt-0.5" size={20} />
                            <div className="text-sm">
                                <p className="font-bold">{missingProfiles.length} login account{missingProfiles.length === 1 ? '' : 's'} without a rewards profile</p>
                                <p className="mt-1">These people can sign in but their dashboard cannot load: {missingProfiles.join(', ')}.
                                    Delete them in Firestore (users collection) so they can register again.</p>
                            </div>
                        </div>
                    )}

                    {orphanProfiles.length > 0 && (
                        <div className="mb-6 bg-slate-100 border border-slate-200 text-slate-700 rounded-2xl p-4 flex gap-3">
                            <AlertTriangle className="flex-shrink-0 mt-0.5" size={20} />
                            <div className="text-sm">
                                <p className="font-bold">{orphanProfiles.length} rewards profile{orphanProfiles.length === 1 ? '' : 's'} without a login</p>
                                <p className="mt-1">
                                    {orphanProfiles.map(u => u.email).join(', ')}. Their login was deleted. If the person registers
                                    again with the same email, an empty profile is reused automatically. A profile that still holds
                                    rewards blocks that email from registering until you delete its row in Supabase (user_profiles).
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STATS OVERVIEW CARDS */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-slate-500 mb-1">Registered Users</p>
                                <h2 className="text-3xl font-bold text-slate-800">{formatCount(users.length)}</h2>
                                <span className="text-xs text-slate-400">{users.filter(u => u.role === 'admin').length} admin</span>
                            </div>
                            <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600"><Users size={24} /></div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-slate-500 mb-1">Rewards Earned</p>
                                <h2 className="text-3xl font-bold text-green-600">{formatInr(stats.rewardsIssued)}</h2>
                                <span className="text-xs text-slate-400">{formatInr(stats.walletTotal)} still in user wallets</span>
                            </div>
                            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-green-600"><Wallet size={24} /></div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-slate-500 mb-1">Paid Out</p>
                                <h2 className="text-3xl font-bold text-indigo-600">{formatInr(stats.paidOut)}</h2>
                                <span className="text-xs text-slate-400">{formatInr(stats.pendingAmount)} pending ({stats.pendingCount})</span>
                            </div>
                            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600"><Landmark size={24} /></div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-slate-500 mb-1">CO₂ Saved <span className="text-xs">(est.)</span></p>
                                <h2 className="text-3xl font-bold text-emerald-600">{formatCo2(stats.co2Kg)}</h2>
                                <span className="text-xs text-slate-400">{formatCount(stats.items)} items recycled</span>
                            </div>
                            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600"><Leaf size={24} /></div>
                        </div>
                    </div>

                    {/* REDEMPTION QUEUE */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-10">
                        <div className="p-6 border-b border-slate-100">
                            <h3 className="text-lg font-bold text-slate-800">Redemption Queue</h3>
                            <p className="text-sm text-slate-500">Withdrawals to pay and vouchers waiting to be claimed. Rejecting or cancelling refunds the user.</p>
                        </div>
                        {actionError && <p className="mx-6 mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{actionError}</p>}
                        {queue.length === 0 ? (
                            <p className="p-8 text-center text-slate-400">Nothing waiting. 🎉</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {queue.map(({ user: u, redemption: r }) => (
                                    <li key={`${u.email}|${r.code}`} className="p-4 md:px-6 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${r.type === 'money' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                                                {r.type === 'money' ? <Landmark size={18} /> : <Ticket size={18} />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-800">
                                                    {r.type === 'money' ? `Withdraw ${formatInr(r.cost)} → ${r.upiId}` : `${r.item} (${r.cost} pts)`}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {u.name || u.email} · {u.email} · {formatDateTime(r.date)} · <span className="font-mono">{r.code}</span>
                                                </p>
                                            </div>
                                        </div>
                                        <RedemptionActions email={u.email} redemption={r} {...actionProps} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* MAIN TABLE SECTION */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">User Database</h3>
                                <p className="text-sm text-slate-500">Manage and view all registered recyclers.</p>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Search users..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64 transition"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-semibold">
                                    <tr>
                                        <th className="p-5 tracking-wide">User Profile</th>
                                        <th className="p-5 tracking-wide">Role</th>
                                        <th className="p-5 tracking-wide">Wallet Balance</th>
                                        <th className="p-5 tracking-wide">Eco Points</th>
                                        <th className="p-5 tracking-wide">Items</th>
                                        <th className="p-5 tracking-wide">Joined</th>
                                        <th className="p-5 tracking-wide text-right">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredUsers.length > 0 ? (
                                        filteredUsers.map((u) => (
                                            <tr key={u._id || u.email} className="hover:bg-indigo-50/30 transition duration-150">
                                                <td className="p-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                                                            {String(u.name || u.email || '?').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-800">{u.name || '—'}</p>
                                                            <p className="text-sm text-slate-500">{u.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-5">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${u.role === 'admin'
                                                        ? 'bg-purple-100 text-purple-700 border-purple-200'
                                                        : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                        {String(u.role || 'user').toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="p-5 font-bold text-green-600">{formatInr(u.walletBalance)}</td>
                                                <td className="p-5">
                                                    <div className="font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg inline-block">
                                                        {formatCount(u.ecoPoints)} pts
                                                    </div>
                                                </td>
                                                <td className="p-5 text-slate-600">{formatCount(u.impact?.items)}</td>
                                                <td className="p-5 text-slate-500 text-sm">{formatDate(u.createdAt)}</td>
                                                <td className="p-5 text-right">
                                                    <button
                                                        onClick={() => { setConfirming(null); setActionError(null); setSelectedEmail(u.email); }}
                                                        aria-label={`View ${u.email}`}
                                                        className="text-slate-400 hover:text-indigo-600 transition"
                                                    >
                                                        <ArrowUpRight size={20} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="7" className="p-8 text-center text-slate-400">
                                                {users.length ? `No users found matching "${searchTerm}"` : 'No users yet.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                            <span className="text-sm text-slate-500">Showing {filteredUsers.length} records</span>
                            <button
                                onClick={exportCsv}
                                disabled={!filteredUsers.length}
                                className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-lg transition disabled:opacity-40"
                            >
                                <Download size={16} /> Export CSV
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* USER DETAIL DRAWER */}
            {selectedUser && (
                <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setSelectedEmail(null)}>
                    <aside
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="user-detail-title"
                        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 sticky top-0 bg-white">
                            <div className="min-w-0">
                                <h2 id="user-detail-title" className="text-xl font-bold text-slate-800 truncate">{selectedUser.name || '—'}</h2>
                                <p className="text-sm text-slate-500 truncate">{selectedUser.email}</p>
                                <p className="text-xs text-slate-400 mt-1">
                                    {String(selectedUser.role || 'user').toUpperCase()} · Joined {formatDate(selectedUser.createdAt)}
                                    {!selectedUser.hasLogin && ' · No login account'}
                                </p>
                            </div>
                            <button onClick={() => setSelectedEmail(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700">
                                <X size={22} />
                            </button>
                        </div>

                        <div className="p-6 grid grid-cols-2 gap-3">
                            {[
                                ['Wallet', formatInr(selectedUser.walletBalance)],
                                ['Eco Points', formatCount(selectedUser.ecoPoints)],
                                ['Items recycled', formatCount(selectedUser.impact?.items)],
                                ['CO₂ saved (est.)', formatCo2(selectedUser.impact?.co2Kg)],
                            ].map(([label, value]) => (
                                <div key={label} className="bg-slate-50 rounded-xl p-4">
                                    <p className="text-xs text-slate-500">{label}</p>
                                    <p className="text-lg font-bold text-slate-800">{value}</p>
                                </div>
                            ))}
                        </div>

                        <div className="px-6 pb-6">
                            <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Ticket size={18} /> Redemptions</h3>
                            {actionError && <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{actionError}</p>}
                            {(selectedUser.redemptions || []).length === 0 ? (
                                <p className="text-sm text-slate-400">No redemptions.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {selectedUser.redemptions.slice().reverse().map((r, i) => (
                                        <li key={r.code || `${r.date}-${i}`} className="border border-slate-100 rounded-xl p-3">
                                            <div className="flex justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-slate-800">
                                                        {r.type === 'money' ? `Withdrawal ${formatInr(r.cost)}` : `${r.item} · ${r.cost} pts`}
                                                    </p>
                                                    <p className="text-xs text-slate-500">{formatDateTime(r.date)}</p>
                                                    {r.code && <p className="text-xs font-mono text-slate-600">{r.code}{r.upiId ? ` · ${r.upiId}` : ''}</p>}
                                                    {r.processedBy && <p className="text-xs text-slate-400">by {r.processedBy} · {formatDateTime(r.processedAt)}</p>}
                                                </div>
                                                <StatusBadge status={r.status} />
                                            </div>
                                            <div className="mt-2">
                                                <RedemptionActions email={selectedUser.email} redemption={r} {...actionProps} />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="px-6 pb-10">
                            <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Recycle size={18} /> Recent Activity</h3>
                            {(selectedUser.logs || []).length === 0 ? (
                                <p className="text-sm text-slate-400">No items recycled yet.</p>
                            ) : (
                                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                                    {selectedUser.logs.slice().reverse().slice(0, 20).map((l, i) => (
                                        <li key={l.session || `${l.date}-${i}`} className="p-3 flex justify-between gap-3 text-sm">
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-800">{l.wasteType}</p>
                                                <p className="text-xs text-slate-500 truncate">{formatDateTime(l.date)} · {l.location || 'Unknown location'}</p>
                                            </div>
                                            <span className="font-bold text-green-600 flex-shrink-0">+{formatInr(l.amount)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}
