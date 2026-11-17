import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AuthProvider from './AuthProvider';
import ThemeProvider from './ThemeProvider';
import { useAuth } from './authContext';
import Landing from './landing';
import { AuthCallback, ForgotPassword, ResetPassword, FullPageLoader, ProfileLoadError } from './authPages';
import { BRAND_NAME } from './brand';

// Every page except the landing page is loaded on demand. The heavy ones matter most:
// the scanner pulls in the AI model runtime, the map Leaflet, and the dashboard/admin charts.
const About = lazy(() => import('./about'));
const Dashboard = lazy(() => import('./dashboard'));
const Scanner = lazy(() => import('./scanner'));
const Admin = lazy(() => import('./admin'));
const Leaderboard = lazy(() => import('./leaderboard'));
const BinMap = lazy(() => import('./binMap'));
const Login = lazy(() => import('./auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./auth').then((m) => ({ default: m.Register })));

const TITLES = {
  '/': `${BRAND_NAME} · Scan. Sort. Earn.`,
  '/login': 'Log in',
  '/register': 'Create account',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
  '/auth/callback': 'Signing in',
  '/dashboard': 'Dashboard',
  '/scan': 'Scan a bin',
  '/admin': 'Admin',
  '/map': 'Bin map',
  '/about': 'About',
  '/leaderboard': 'Leaderboard',
};

// Per-page tab titles (screen readers announce them) and start each new page at the top.
function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES[pathname];
    document.title = !t || pathname === '/' ? TITLES['/'] : `${t} · ${BRAND_NAME}`;
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// UI-level guard only. The API independently rejects missing/invalid sessions and non-admins.
function RequireAuth({ role, children }) {
  const { status, profile, profileStatus, home } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (role) {
    if (profileStatus === 'error') return <ProfileLoadError />;
    if (profileStatus !== 'ready') return <FullPageLoader />;
    if (profile.role !== role) return <Navigate to={home} replace />;
  }
  return children;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <RouteEffects />
          <Suspense fallback={<FullPageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/scan" element={<RequireAuth><Scanner /></RequireAuth>} />
              <Route path="/admin" element={<RequireAuth role="admin"><Admin /></RequireAuth>} />
              <Route path="/map" element={<BinMap />} />
              <Route path="/about" element={<About />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
export default App;
