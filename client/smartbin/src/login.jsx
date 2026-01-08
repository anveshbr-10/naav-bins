import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Recycle, Loader2 } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); // New loading state
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); // Start loading

    try {
      // We use the cloud API
      const res = await axios.post('https://smartbin-api.onrender.com/api/login', {
        email,
        password,
      });

      if (res.data.status === 'ok') {
        localStorage.setItem('token', res.data.token);
        // Check if admin or user
        if (res.data.role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      } else {
        alert("Login Failed: " + (res.data.error || "Check your email/password"));
        setLoading(false); // Stop loading on fail
      }
    } catch (err) {
      console.error(err);
      alert("Server Error. If this takes long, the free server is waking up. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">

        <div className="text-center mb-8">
          <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Recycle className="text-emerald-600 w-8 h-8" />
          </div>
          <h2 className="text-3xl font-bold text-slate-800">Welcome Back</h2>
          <p className="text-slate-500">Login to access your SmartBin wallet</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading} // Disable button while loading
            className={`w-full py-3 rounded-lg font-bold text-lg text-white transition-all transform flex items-center justify-center gap-2
              ${loading
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 hover:scale-[1.02] shadow-lg shadow-emerald-500/30'
              }`}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" /> Connecting...
              </>
            ) : (
              "Login"
            )}
          </button>
        </form>

        {/* HELPFUL MESSAGE FOR EVALUATORS */}
        {loading && (
          <div className="mt-4 p-3 bg-blue-50 text-blue-700 text-xs rounded-lg text-center animate-pulse">
            <b>Note:</b> Connecting to free cloud server. <br />This may take up to 60 seconds. Please wait.
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-slate-600">
            Don't have an account?{' '}
            <button onClick={() => navigate('/register')} className="text-emerald-600 font-bold hover:underline">
              Register
            </button>
          </p>
        </div>

      </div>
    </div>
  );
}