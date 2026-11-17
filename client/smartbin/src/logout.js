import { useCallback } from 'react';
import { useAuth } from './authContext';

// Position of the current page in this tab's history (React Router's history.state.idx).
const historyIndex = () => window.history.state?.idx ?? 0;

// Log out and drop every page visited in this tab: rewind to the first page of the site and
// replace it with the landing page. The browser's Back then leaves the site instead of
// reopening the dashboard, admin console or any other page from the signed-in session.
export function useLogout() {
  const { signOut } = useAuth();
  return useCallback(async () => {
    await signOut();
    const steps = historyIndex();
    if (steps > 0) {
      window.addEventListener('popstate', () => window.location.replace('/'), { once: true });
      window.history.go(-steps);
    } else {
      window.location.replace('/');
    }
  }, [signOut]);
}
