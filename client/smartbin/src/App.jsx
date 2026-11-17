import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AuthProvider from './AuthProvider';
import ThemeProvider from './ThemeProvider';
import I18nProvider from './I18nProvider';
import { useAuth } from './authContext';
import { useI18n, tk } from './i18n';
import Landing from './landing';
import { AuthCallback, ForgotPassword, ResetPassword, FullPageLoader, ProfileLoadError } from './authPages';
import { BRAND_NAME } from './brand';

// Every page except the landing page is loaded on demand. The heavy ones matter most:
// the scanner pulls in the AI model runtime, the map Leaflet, and the dashboard/console charts.
const About = lazy(() => import('./about'));
const Dashboard = lazy(() => import('./dashboard'));
const Scanner = lazy(() => import('./scanner'));
const Admin = lazy(() => import('./admin/AdminConsole'));
const Counter = lazy(() => import('./counter'));
const Leagues = lazy(() => import('./leaderboard'));
const BinMap = lazy(() => import('./binMap'));
const BinDisplay = lazy(() => import('./binDisplay'));
const Login = lazy(() => import('./auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./auth').then((m) => ({ default: m.Register })));

const TITLES = {
  '/login': tk('Log in'),
  '/register': tk('Create account'),
  '/forgot-password': tk('Forgot password'),
  '/reset-password': tk('Reset password'),
  '/auth/callback': tk('Signing in'),
  '/dashboard': tk('Dashboard'),
  '/scan': tk('Scan a bin'),
  '/admin': tk('Operations console'),
  '/counter': tk('Voucher counter'),
  '/map': tk('Bin map'),
  '/about': tk('About'),
  '/leagues': tk('Campus leagues'),
  '/bin-display': tk('Bin screen'),
};

// Per-page tab titles (screen readers announce them) and start each new page at the top.
function RouteEffects() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  useEffect(() => {
    const title = TITLES[pathname];
    document.title = title ? `${t(title)} · ${BRAND_NAME}` : `${BRAND_NAME} · ${t('Scan. Sort. Earn.')}`;
  }, [pathname, t]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// UI-level guard only. The API independently rejects missing/invalid sessions and wrong roles.
function RequireAuth({ roles, children }) {
  const { status, profile, profileStatus, home } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (roles) {
    if (profileStatus === 'error') return <ProfileLoadError />;
    if (profileStatus !== 'ready') return <FullPageLoader />;
    if (!roles.includes(profile.role)) return <Navigate to={home} replace />;
  }
  return children;
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
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
                <Route path="/admin" element={<RequireAuth roles={['admin']}><Admin /></RequireAuth>} />
                <Route path="/counter" element={<RequireAuth roles={['admin', 'vendor']}><Counter /></RequireAuth>} />
                <Route path="/map" element={<BinMap />} />
                <Route path="/about" element={<About />} />
                <Route path="/leagues" element={<Leagues />} />
                <Route path="/leaderboard" element={<Navigate to="/leagues" replace />} />
                <Route path="/bin-display" element={<BinDisplay />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
export default App;
