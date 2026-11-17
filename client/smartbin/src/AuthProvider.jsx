import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import api, { apiStatus } from './api';
import { AuthContext } from './authContext';

// Single source of truth for "who is signed in" across the app.
// - Session: Supabase Auth (persisted in the browser, refreshed automatically).
// - Profile + role: loaded from our API (/api/me) whenever the signed-in user changes.
export default function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [profileEntry, setProfileEntry] = useState({ userId: null, key: -1, status: 'idle', profile: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (active) setSession(newSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id || null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    api.get('/api/me')
      .then((res) => {
        if (active) setProfileEntry({ userId, key: reloadKey, status: 'ready', profile: res.data.profile });
      })
      .catch((err) => {
        if (!active) return;
        // The account was deleted or the session is no longer valid: sign out locally.
        if (apiStatus(err) === 401) supabase.auth.signOut({ scope: 'local' });
        setProfileEntry({ userId, key: reloadKey, status: 'error', profile: null });
      });
    return () => { active = false; };
  }, [userId, reloadKey]);

  const signOut = useCallback(async () => {
    localStorage.removeItem('current_bin_location');
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const reloadProfile = useCallback(() => setReloadKey((k) => k + 1), []);

  const value = useMemo(() => {
    // Only trust the entry loaded for this user and this reload; anything else is still loading.
    const current = userId && profileEntry.userId === userId && profileEntry.key === reloadKey ? profileEntry : null;
    const profileStatus = !userId ? 'idle' : current ? current.status : 'loading';
    const profile = current?.profile || null;
    return {
      status: !ready ? 'loading' : session ? 'signedIn' : 'signedOut',
      session,
      user: session?.user || null,
      profile,
      profileStatus,
      home: profile?.role === 'admin' ? '/admin' : profile?.role === 'vendor' ? '/counter' : '/dashboard',
      signOut,
      reloadProfile,
    };
  }, [ready, session, userId, profileEntry, reloadKey, signOut, reloadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
