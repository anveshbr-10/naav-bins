import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Loader2, Recycle, MailCheck, KeyRound, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { supabase, AUTH_REDIRECTS, authErrorMessage } from './supabase';
import { useAuth } from './authContext';

// Errors that Supabase puts in the redirect URL (e.g. expired email link, cancelled social login).
function readUrlError() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const description = params.get('error_description') || query.get('error_description');
  const code = params.get('error_code') || query.get('error_code');
  if (!description && !code) return null;
  return authErrorMessage({ code, message: description }, 'Sign-in could not be completed.');
}

function AuthCard({ icon, title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d2a1a] p-5">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8">
        <Link to="/" className="flex items-center gap-2 text-green-700 font-bold mb-6">
          <Recycle size={22} /> SmartBin
        </Link>
        <div className="w-12 h-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-4">{icon}</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function FullPageLoader({ message = 'Loading…' }) {
  return (
    <div className="flex flex-col h-screen items-center justify-center gap-3 text-gray-600">
      <Loader2 className="animate-spin text-green-600" size={40} />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

// Shown when the user is signed in but their account details could not be loaded.
export function ProfileLoadError() {
  const { reloadProfile, signOut } = useAuth();
  return (
    <AuthCard icon={<AlertTriangle />} title="Could not load your account">
      <p className="text-gray-500 text-sm">You are signed in, but the server did not respond. It may be waking up (up to 30 seconds).</p>
      <div className="flex gap-3 mt-6">
        <button onClick={reloadProfile} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">
          <RefreshCw size={16} /> Try again
        </button>
        <button onClick={signOut} className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </AuthCard>
  );
}

// Landing point for email-confirmation links and social logins.
export function AuthCallback() {
  const { status, profileStatus, home } = useAuth();
  const [urlError] = useState(readUrlError);

  if (urlError && status !== 'signedIn') {
    return (
      <AuthCard icon={<AlertTriangle />} title="Sign-in not completed">
        <p className="text-gray-600 text-sm">{urlError}</p>
        <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">Back to sign in</Link>
      </AuthCard>
    );
  }
  if (status === 'loading' || (status === 'signedIn' && profileStatus === 'loading')) return <FullPageLoader message="Signing you in…" />;
  if (status === 'signedIn' && profileStatus === 'error') return <ProfileLoadError />;
  if (status === 'signedIn') return <Navigate to={home} replace />;
  return (
    <AuthCard icon={<AlertTriangle />} title="Link invalid or expired">
      <p className="text-gray-600 text-sm">Please sign in again, or request a new email from the sign-in page.</p>
      <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">Back to sign in</Link>
    </AuthCard>
  );
}

export function ForgotPassword() {
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
      <AuthCard icon={<MailCheck />} title="Check your email">
        <p className="text-gray-600 text-sm">
          If an account exists for <strong>{email.trim()}</strong>, we have sent a link to reset your password. The link works once and expires soon.
        </p>
        <Link to="/login" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">Back to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound />} title="Forgot your password?">
      <p className="text-gray-500 text-sm mb-6">Enter your account email and we will send you a reset link.</p>
      <form onSubmit={submit} className="space-y-4">
        <input
          type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email Address" disabled={state === 'sending'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <button type="submit" disabled={state === 'sending'} className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
          {state === 'sending' ? <><Loader2 size={18} className="animate-spin" /> Sending…</> : 'Send reset link'}
        </button>
      </form>
      <Link to="/login" className="block text-center text-sm text-green-700 mt-5 hover:underline">Back to sign in</Link>
    </AuthCard>
  );
}

// Opened from the password-reset email: the link signs the user in with a temporary session.
export function ResetPassword() {
  const { status, home } = useAuth();
  const navigate = useNavigate();
  const [urlError] = useState(readUrlError);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | done
  const [error, setError] = useState(null);

  if (status === 'loading') return <FullPageLoader />;

  if (status !== 'signedIn') {
    return (
      <AuthCard icon={<AlertTriangle />} title="Reset link invalid or expired">
        <p className="text-gray-600 text-sm">{urlError || 'Please request a new password reset email.'}</p>
        <Link to="/forgot-password" className="block text-center mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">Request a new link</Link>
      </AuthCard>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
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
      <AuthCard icon={<MailCheck />} title="Password updated">
        <p className="text-gray-600 text-sm">Your password has been changed and you are signed in.</p>
        <button onClick={() => navigate(home, { replace: true })} className="w-full mt-6 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700">Continue</button>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound />} title="Choose a new password">
      <form onSubmit={submit} className="space-y-4 mt-4">
        <input
          type="password" required minLength={8} maxLength={72} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (min 8 characters)"
          disabled={state === 'saving'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        <input
          type="password" required minLength={8} maxLength={72} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password"
          disabled={state === 'saving'}
          className="w-full p-3 rounded-xl bg-green-50 border-2 border-transparent focus:border-green-600 focus:bg-white outline-none"
        />
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
        <button type="submit" disabled={state === 'saving'} className="w-full py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2">
          {state === 'saving' ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : 'Update password'}
        </button>
      </form>
    </AuthCard>
  );
}
