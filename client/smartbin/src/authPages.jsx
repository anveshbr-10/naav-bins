import { BackButton } from './nav';
import { useLogout } from './logout';
import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Loader2, MailCheck, KeyRound, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { Logo, BRAND_NAME } from './brand';
import { supabase, AUTH_REDIRECTS, authErrorMessage } from './supabase';
import { useAuth } from './authContext';
import { useI18n, tk } from './i18n';
import { LanguageSwitcher } from './layout';

// Errors that Supabase puts in the redirect URL (e.g. expired email link, cancelled social login).
function readUrlError() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const description = params.get('error_description') || query.get('error_description');
  const code = params.get('error_code') || query.get('error_code');
  if (!description && !code) return null;
  return authErrorMessage({ code, message: description }, tk('Sign-in could not be completed.'));
}

function AuthCard({ icon, title, children }) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0d2a1a] p-4 sm:p-5 relative">
      <div className="absolute top-4 left-4"><BackButton tone="light" /></div>
      <div className="absolute top-4 right-4"><LanguageSwitcher tone="light" /></div>
      <main className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 sm:p-8">
        <Link to="/" aria-label={t('{brand} home', { brand: BRAND_NAME })} className="inline-flex mb-6 rounded-lg">
          <Logo size={30} textClassName="text-lg" />
        </Link>
        <div className="w-12 h-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-4" aria-hidden="true">{icon}</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function FullPageLoader({ message = tk('Loading…') }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex flex-col min-h-dvh items-center justify-center gap-3 text-gray-600 px-4 text-center">
      <Loader2 className="animate-spin text-green-600" size={40} aria-hidden="true" />
      <p className="font-semibold">{t(message)}</p>
    </div>
  );
}

// Shown when the user is signed in but their account details could not be loaded.
export function ProfileLoadError() {
  const { reloadProfile } = useAuth();
  const signOut = useLogout();
  const { t } = useI18n();
  return (
    <AuthCard icon={<AlertTriangle />} title={t('Could not load your account')}>
      <p className="text-gray-500 text-sm">{t('You are signed in, but the server did not respond. It may be waking up (up to 30 seconds).')}</p>
      <div className="flex gap-3 mt-6">
        <button onClick={reloadProfile} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">
          <RefreshCw size={16} /> {t('Try again')}
        </button>
        <button onClick={signOut} className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200">
          <LogOut size={16} /> {t('Sign out')}
        </button>
      </div>
    </AuthCard>
  );
}

// Landing point for email-confirmation links and social logins.
export function AuthCallback() {
  const { status, profileStatus, home } = useAuth();
  const { t } = useI18n();
  const [urlError] = useState(readUrlError);

  if (urlError && status !== 'signedIn') {
    return (
      <AuthCard icon={<AlertTriangle />} title={t('Sign-in not completed')}>
        <p className="text-gray-600 text-sm">{urlError}</p>
        <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">{t('Back to sign in')}</Link>
      </AuthCard>
    );
  }
  if (status === 'loading' || (status === 'signedIn' && profileStatus === 'loading')) return <FullPageLoader message={tk('Signing you in…')} />;
  if (status === 'signedIn' && profileStatus === 'error') return <ProfileLoadError />;
  if (status === 'signedIn') return <Navigate to={home} replace />;
  return (
    <AuthCard icon={<AlertTriangle />} title={t('Link invalid or expired')}>
      <p className="text-gray-600 text-sm">{t('Please sign in again, or request a new email from the sign-in page.')}</p>
      <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">{t('Back to sign in')}</Link>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setState('sending');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: AUTH_REDIRECTS.resetPassword() });
    if (err) {
      setError(authErrorMessage(err));
      setState('idle');
      return;
    }
    setState('sent');
  };

  if (state === 'sent') {
    return (
      <AuthCard icon={<MailCheck />} title={t('Check your email')}>
        <p className="text-gray-600 text-sm">
          {t('If an account exists for {email}, we have sent a link to reset your password. The link works once and expires soon.', { email: email.trim() })}
        </p>
        <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">{t('Back to sign in')}</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound />} title={t('Forgot your password?')}>
      <p className="text-gray-500 text-sm mb-6">{t('Enter your account email and we will send you a reset link.')}</p>
      <form onSubmit={submit} className="space-y-4">
        <input
          type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={t('Email address')} aria-label={t('Email address')} disabled={state === 'sending'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <button type="submit" disabled={state === 'sending'} className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
          {state === 'sending' ? <><Loader2 size={18} className="animate-spin" /> {t('Sending…')}</> : t('Send reset link')}
        </button>
      </form>
      <Link to="/login" className="block text-center text-sm text-green-700 mt-5 hover:underline">{t('Back to sign in')}</Link>
    </AuthCard>
  );
}

// Opened from the password-reset email: the link signs the user in with a temporary session.
export function ResetPassword() {
  const { status, home } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [urlError] = useState(readUrlError);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | done
  const [error, setError] = useState(null);

  if (status === 'loading') return <FullPageLoader />;

  if (status !== 'signedIn') {
    return (
      <AuthCard icon={<AlertTriangle />} title={t('Reset link invalid or expired')}>
        <p className="text-gray-600 text-sm">{urlError || t('Please request a new password reset email.')}</p>
        <Link to="/forgot-password" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">{t('Request a new link')}</Link>
      </AuthCard>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError(t('The two passwords do not match.')); return; }
    setState('saving');
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(authErrorMessage(err));
      setState('idle');
      return;
    }
    setState('done');
  };

  if (state === 'done') {
    return (
      <AuthCard icon={<MailCheck />} title={t('Password updated')}>
        <p className="text-gray-600 text-sm">{t('Your password has been changed and you are signed in.')}</p>
        <button onClick={() => navigate(home, { replace: true })} className="w-full mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">{t('Continue')}</button>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound />} title={t('Choose a new password')}>
      <form onSubmit={submit} className="space-y-4 mt-4">
        <input
          type="password" required minLength={8} maxLength={72} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('New password (min 8 characters)')} aria-label={t('New password')}
          disabled={state === 'saving'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        <input
          type="password" required minLength={8} maxLength={72} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('Confirm new password')} aria-label={t('Confirm new password')}
          disabled={state === 'saving'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <button type="submit" disabled={state === 'saving'} className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
          {state === 'saving' ? <><Loader2 size={18} className="animate-spin" /> {t('Saving…')}</> : t('Update password')}
        </button>
      </form>
    </AuthCard>
  );
}
