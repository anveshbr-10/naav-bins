import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

// { status: 'loading' | 'signedIn' | 'signedOut', session, user, profile,
//   profileStatus: 'idle' | 'loading' | 'ready' | 'error', home, signOut, reloadProfile }
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
