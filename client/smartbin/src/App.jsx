import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthProvider from './AuthProvider';
import { useAuth } from './authContext';
import Landing from './landing';
import About from './about';
import Dashboard from './dashboard';
import Scanner from './scanner';
import Admin from './admin';
import Leaderboard from './leaderboard';
import { Login, Register } from './auth';
import { AuthCallback, ForgotPassword, ResetPassword, FullPageLoader, ProfileLoadError } from './authPages';
import SmartBinMap from './smartbinmaps';

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
    <AuthProvider>
      <BrowserRouter>
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
          <Route path="/map" element={<SmartBinMap />} />
          <Route path="/about" element={<About />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
export default App;
