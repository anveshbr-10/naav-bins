import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, ArrowLeft } from 'lucide-react';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  async function handleRegister(e) {
    e.preventDefault();
    try {
      const res = await axios.post('https://smartbin-api-c7g4.onrender.com/api/register', {
        name, email, password
      });

      if (res.data.status === 'ok') {
        alert("Registration Successful! Please Login.");
        navigate('/login');
      } else {
        alert("Error: Email might already be in use.");
      }
    } catch (err) {
      alert("Server connection failed.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-400 to-green-600 p-4">
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl w-full max-w-md transform transition-all hover:scale-[1.01]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserPlus className="text-green-600 w-8 h-8" />
          </div>
          <h2 className="text-3xl font-bold text-gray-800">Create Account</h2>
          <p className="text-gray-500">Join the SmartBin revolution today</p>
        </div>

        {/* Form */}
        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              required
              type="text"
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
              placeholder="John Doe"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input
              required
              type="email"
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
              placeholder="john@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              required
              type="password"
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl shadow-lg transition transform active:scale-95">
            Sign Up
          </button>
        </form>

        {/* Footer Links */}
        <div className="mt-6 text-center border-t pt-4">
          <p className="text-gray-600">Already have an account?</p>
          <Link to="/login" className="text-green-600 font-bold hover:underline mt-1 inline-block">
            Login here
          </Link>
        </div>

        <Link to="/" className="flex items-center justify-center gap-2 mt-4 text-gray-400 hover:text-gray-600 text-sm">
          <ArrowLeft size={16} /> Back to Home
        </Link>
      </div>
    </div>
  );
}