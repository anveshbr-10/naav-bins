import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getSession } from './api';
import Landing from './landing';
import About from './about';

import Dashboard from './dashboard';
import Scanner from './scanner';
import Admin from './admin';
import Leaderboard from './leaderboard';
import { Login, Register } from './auth';
import SmartBinMap from './smartbinmaps';

// UI-level guard only. The API independently rejects missing/invalid tokens and non-admins.
function RequireAuth({ role, children }) {
  const session = getSession();
  if (!session) return <Navigate to="/login" replace />;
  if (role && session.role !== role) return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/scan" element={<RequireAuth><Scanner /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth role="admin"><Admin /></RequireAuth>} />
        <Route path="/map" element={<SmartBinMap />} />
        <Route path="/about" element={<About />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;