import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, ArrowLeft, Loader2, Info } from 'lucide-react'; // Added Loader2 icon

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false); // <--- New State for loading
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setIsLoading(true); // <--- Start loading

    try {
      const res = await axios.post('https://smartbin-api-c7g4.onrender.com/api/login', { email, password });
      if (res.data.status === 'ok') {
        localStorage.setItem('token', res.data.token);
        // Check role for redirection
        if (res.data.role === 'admin') navigate('/admin');
        else navigate('/dashboard');
      } else {
        alert("Invalid Credentials. Please try again.");
        setIsLoading(false); // <--- Stop loading on failure
      }
    } catch (err) {
      alert("Server connection error.");
      setIsLoading(false); // <--- Stop loading on error
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-500 to-emerald-700 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md transform transition-all hover:scale-[1.01]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn className="text-green-600 w-8 h-8" />
          </div>
          <h2 className="text-3xl font-bold text-gray-800">Welcome Back</h2>
          <p className="text-gray-500">Login to access your SmartBin Wallet</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input
              required
              type="email"
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
              placeholder="john@example.com"
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading} // Disable input while loading
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <a href="#" className="text-sm text-green-600 hover:underline">Forgot?</a>
            </div>
            <input
              required
              type="password"
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition"
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading} // Disable input while loading
            />
          </div>

          <button
            disabled={isLoading} // Prevent double clicks
            className={`w-full bg-green-600 text-white font-bold py-3 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2
              ${isLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-green-700'}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Logging In...
              </>
            ) : (
              "Login"
            )}
          </button>

          {/* --- SERVER WAKE-UP MESSAGE --- */}
          <p className="text-xs text-center text-gray-400 mt-3 flex items-center justify-center gap-1">
            <Info size={12} /> Note: Server may take ~30s to wake up on first try.
          </p>
        </form>

        {/* Footer Links */}
        <div className="mt-8 text-center border-t pt-6">
          <p className="text-gray-600">New to SmartBin?</p>
          <Link to="/register" className="text-green-600 font-bold hover:underline mt-1 inline-block">
            Create an account
          </Link>
        </div>

        <Link to="/" className="flex items-center justify-center gap-2 mt-4 text-gray-400 hover:text-gray-600 text-sm">
          <ArrowLeft size={16} /> Back to Home
        </Link>
      </div>
    </div>
  );
}     