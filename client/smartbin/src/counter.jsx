import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Search, Loader2, CheckCircle2, XCircle, Ticket, MapPin, ListChecks } from 'lucide-react';
import AppShell from './layout';
import api, { apiErrorMessage, apiStatus } from './api';
import { useAuth } from './authContext';
import { useI18n, tk, localized } from './i18n';
import { formatDateTime } from './format';
import { STATUS_LABEL } from './waste';

// Canteen / snack stall / stationery / print-centre counter: look up a student's campus-credit code and
// mark it used. Staff belong to one counter and only see vouchers issued for it; each code can be claimed
// once and each counter has a daily limit (all enforced by the API and the database).
export default function Counter() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState(null);
  const [state, setState] = useState('idle'); // idle | looking | claiming | claimed
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null); // { vendor, today }
  const [meError, setMeError] = useState(null);

  const handleAuth = useCallback((err) => {
    const status = apiStatus(err);
    if (status === 401) { signOut().then(() => navigate('/login')); return true; }
    return false;
  }, [navigate, signOut]);

  const loadMe = useCallback(() => {
    api.get('/api/counter/me')
      .then((res) => { setMe(res.data); setMeError(null); })
      .catch((err) => { if (!handleAuth(err)) setMeError(apiErrorMessage(err, tk('Could not load this counter.'))); });
  }, [handleAuth]);

  useEffect(() => { loadMe(); }, [loadMe]);

  const normalized = code.trim().toUpperCase().replace(/\s+/g, '');

  const lookup = async (e) => {
    e.preventDefault();
    setError(null);
    setVoucher(null);
    setState('looking');
    try {
      const res = await api.get(`/api/counter/voucher/${encodeURIComponent(normalized)}`);
      setVoucher(res.data.voucher);
      setState('idle');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(apiErrorMessage(err, tk('Could not look up this code.')));
      setState('idle');
    }
  };

  const claim = async () => {
    setError(null);
    setState('claiming');
    try {
      await api.post(`/api/counter/voucher/${encodeURIComponent(voucher.code)}/claim`);
      setVoucher({ ...voucher, status: 'Claimed', processed_at: new Date().toISOString() });
      setState('claimed');
      loadMe();
    } catch (err) {
      if (handleAuth(err)) return;
      setError(apiErrorMessage(err, tk('Could not mark this code as used.')));
      setState('idle');
    }
  };

  const usable = voucher && voucher.status === 'Issued';

  return (
    <AppShell footer={false}>
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-amber-100 text-amber-700 p-3 rounded-xl"><Store aria-hidden="true" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{me?.vendor ? localized(me.vendor, 'name', lang) : t('Voucher counter')}</h1>
            <p className="text-sm text-gray-500">
              {me?.vendor
                ? <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {me.vendor.location || t('Campus counter')}</span>
                : me ? t('Admin: all counters') : t('Check a student\'s campus-credit code and mark it as used.')}
            </p>
          </div>
        </div>

        {meError && <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{meError}</p>}

        <form onSubmit={lookup} className="flex gap-2">
          <label className="sr-only" htmlFor="voucher-code">{t('Voucher code')}</label>
          <input
            id="voucher-code"
            value={code}
            onChange={(e) => { setCode(e.target.value); setState('idle'); }}
            placeholder="NB-ABCD-2345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="flex-1 p-3 rounded-xl border border-gray-300 bg-white font-mono text-lg tracking-wider uppercase focus:ring-2 focus:ring-green-500 outline-none"
          />
          <button type="submit" disabled={!normalized || state === 'looking'} className="px-5 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
            {state === 'looking' ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} aria-hidden="true" />}
            <span className="hidden sm:inline">{t('Check')}</span>
          </button>
        </form>

        {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

        {voucher && (
          <div className={`mt-6 rounded-2xl border p-6 ${usable ? 'border-green-200 bg-white' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-start gap-3">
              {state === 'claimed' ? <CheckCircle2 className="text-green-600 flex-shrink-0" size={28} aria-hidden="true" />
                : usable ? <Ticket className="text-green-600 flex-shrink-0" size={28} aria-hidden="true" />
                  : <XCircle className="text-red-500 flex-shrink-0" size={28} aria-hidden="true" />}
              <div className="min-w-0">
                <p className="text-lg font-bold text-gray-900">{voucher.item}</p>
                <p className="font-mono text-sm text-gray-600">{voucher.code}</p>
                <p className="text-sm text-gray-500 mt-1">{t('Issued to {name} on {date}', { name: voucher.userName || t('a student'), date: formatDateTime(voucher.created_at) })}</p>
                {voucher.vendor && <p className="text-sm text-gray-500">{t('Valid at: {place}', { place: voucher.vendor })}</p>}
                <p className={`mt-2 inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${usable ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {t(STATUS_LABEL[voucher.status] || voucher.status)}
                </p>
                {!usable && state !== 'claimed' && (
                  <p className="mt-2 text-sm text-red-600">
                    {voucher.status === 'Claimed'
                      ? t('Already used on {date}. Do not accept it again.', { date: formatDateTime(voucher.processed_at) })
                      : t('This code is not valid any more.')}
                  </p>
                )}
              </div>
            </div>
            {usable && state !== 'claimed' && (
              <button onClick={claim} disabled={state === 'claiming'} className="mt-5 w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {state === 'claiming' && <Loader2 size={18} className="animate-spin" />} {t('Give the credit and mark as used')}
              </button>
            )}
            {state === 'claimed' && <p role="status" className="mt-4 text-sm font-semibold text-green-700">{t('Done. The code can no longer be used.')}</p>}
          </div>
        )}

        {me && (
          <div className="mt-8">
            <h2 className="font-bold text-gray-800 flex items-center gap-2 mb-1"><ListChecks size={18} aria-hidden="true" /> {t('Claimed today')}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {me.vendor
                ? t('{n} of {limit} vouchers today', { n: me.today.length, limit: me.vendor.dailyClaimLimit })
                : t('{n} vouchers today', { n: me.today.length })}
            </p>
            {me.today.length === 0 ? <p className="text-sm text-gray-400">{t('No vouchers claimed yet today.')}</p> : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl bg-white">
                {me.today.map((c) => (
                  <li key={c.code} className="p-3 flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{c.item}</p>
                      <p className="text-xs text-gray-500 font-mono">{c.code} · {c.userName || t('a student')}</p>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">{formatDateTime(c.processed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
