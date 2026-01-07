import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './landing';
import Login from './login';
import Register from './register'; // New Import
import Dashboard from './dashboard';
import Scanner from './scanner';
import Admin from './admin';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} /> {/* New Route */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/scan" element={<Scanner />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;