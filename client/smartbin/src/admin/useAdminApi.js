import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiStatus } from '../api';
import { useAuth } from '../authContext';

// Sends the admin back to sign-in (401) or their home (403) when the API refuses; returns true if handled.
export function useAuthErrorHandler() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  return useCallback((err) => {
    const status = apiStatus(err);
    if (status === 401) { signOut().then(() => navigate('/login', { replace: true })); return true; }
    if (status === 403) { navigate('/dashboard', { replace: true }); return true; }
    return false;
  }, [navigate, signOut]);
}

// GET a console endpoint: { status: 'loading'|'ready'|'error', data, reload }.
export function useAdminData(url, params) {
  const handleAuthError = useAuthErrorHandler();
  const key = JSON.stringify(params || {});
  const [state, setState] = useState({ status: 'loading', data: null, key: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    api.get(url, { params: JSON.parse(key) })
      .then((res) => { if (active) setState({ status: 'ready', data: res.data, key }); })
      .catch((err) => { if (active && !handleAuthError(err)) setState((s) => ({ ...s, status: 'error' })); });
    return () => { active = false; };
  }, [url, key, nonce, handleAuthError]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status: state.status, data: state.data, reload };
}
