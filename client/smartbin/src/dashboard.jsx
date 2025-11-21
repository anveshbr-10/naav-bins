import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Wallet, Leaf, Trash2, LogOut, History } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if(!token) navigate('/login');
    
    axios.get('http://localhost:5000/api/dashboard', {
        headers: { 'x-access-token': token }
    }).then(res => {
        if(res.data.status === 'ok') setUser(res.data.user);
    });
  }, []);

  if (!user) return <div className="flex h-screen items-center justify-center font-bold text-xl">Loading Dashboard...</div>;

  // --- 100% REAL HISTORY LOGIC ---

  // A. Process Line Chart (Last 7 Days Earnings)
  const processEarningsData = () => {
    if (!user.logs) return [];
    
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }); // "Mon", "Tue"
      const dateString = d.toDateString(); // "Fri Nov 21 2025"

      // Sum up all earnings that happened on this specific day
      const dailyTotal = user.logs
        .filter(log => new Date(log.date).toDateString() === dateString)
        .reduce((sum, log) => sum + (log.amount || 0), 0);

      last7Days.push({ name: dayName, earnings: dailyTotal });
    }
    return last7Days;
  };

  // B. Process Pie Chart (Plastic vs Non-Plastic)
  const processWasteData = () => {
    if (!user.logs || user.logs.length === 0) {
      // Return empty placeholder if no data exists yet
      return [
        { name: 'Plastic', value: 0 }, 
        { name: 'Non-Plastic', value: 0 }
      ];
    }

    const plasticCount = user.logs.filter(l => l.wasteType === 'Plastic').length;
    // Anything that is NOT 'Plastic' goes here
    const nonPlasticCount = user.logs.filter(l => l.wasteType !== 'Plastic').length;

    return [
      { name: 'Plastic', value: plasticCount },
      { name: 'Non-Plastic', value: nonPlasticCount },
    ];
  };

  const lineData = processEarningsData();
  const pieData = processWasteData();
  const COLORS = ['#22c55e', '#64748b']; // Green for Plastic, Gray for Non-Plastic

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* HEADER */}
      <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Hello, {user.name}!</h1>
          <p className="text-gray-500">Your Real-Time Impact Dashboard</p>
        </div>
        <button 
          onClick={() => {localStorage.removeItem('token'); navigate('/')}} 
          className="flex items-center gap-2 bg-red-50 text-red-600 px-5 py-3 rounded-xl font-bold hover:bg-red-100 transition"
        >
          <LogOut size={20}/> Logout
        </button>
      </div>
      
      {/* STATS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition">
          <div>
            <h2 className="text-gray-400 font-medium mb-1">Wallet Balance</h2>
            <p className="text-4xl font-bold text-green-600">₹{user.walletBalance}</p>
          </div>
          <div className="bg-green-100 p-3 rounded-full"><Wallet className="text-green-600" size={32}/></div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition">
          <div>
            <h2 className="text-gray-400 font-medium mb-1">Eco Points</h2>
            <p className="text-4xl font-bold text-blue-600">{user.ecoPoints}</p>
          </div>
          <div className="bg-blue-100 p-3 rounded-full"><Leaf className="text-blue-600" size={32}/></div>
        </div>

         <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition">
          <div>
            <h2 className="text-gray-400 font-medium mb-1">CO2 Saved</h2>
            <p className="text-4xl font-bold text-yellow-600">{(user.ecoPoints * 0.02).toFixed(1)} kg</p>
          </div>
           <div className="bg-yellow-100 p-3 rounded-full"><Trash2 className="text-yellow-600" size={32}/></div>
        </div>
      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        
        {/* Left: Earnings Graph (REAL HISTORY) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold mb-6 text-gray-800">Earnings (Last 7 Days)</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="name" stroke="#aaa" />
                <YAxis stroke="#aaa" />
                <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="earnings" stroke="#16a34a" strokeWidth={3} dot={{ r: 6, fill: '#16a34a', strokeWidth: 2, stroke: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Pie Chart (REAL DISTRIBUTION) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold mb-6 text-gray-800">Plastic vs Non-Plastic</h3>
          <div className="h-64 w-full flex justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ACTION BUTTON */}
      <button 
        onClick={() => navigate('/scan')} 
        className="bg-gradient-to-r from-green-600 to-green-500 text-white w-full py-5 text-xl rounded-2xl shadow-xl hover:shadow-2xl hover:scale-[1.01] transition transform font-bold flex items-center justify-center gap-3"
      >
        Start Smart Bin Scanner
      </button>

      {/* RECENT ACTIVITY LOGS */}
      <div className="mt-8">
        <h3 className="text-xl font-bold mb-4 text-gray-700 flex items-center gap-2"><History/> Recent Activity</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {user.logs && user.logs.length > 0 ? (
             user.logs.slice().reverse().slice(0, 5).map((log, i) => (
               <div key={i} className="p-4 border-b last:border-0 flex justify-between items-center hover:bg-gray-50">
                 <div>
                   <p className="font-bold text-gray-800">{log.wasteType}</p>
                   <p className="text-xs text-gray-500">{new Date(log.date).toLocaleDateString()} at {new Date(log.date).toLocaleTimeString()}</p>
                 </div>
                 <span className="text-green-600 font-bold">+₹{log.amount}</span>
               </div>
             ))
          ) : (
            <div className="p-6 text-center text-gray-400">No activity yet. Scan some items to see data!</div>
          )}
        </div>
      </div>
    </div>
  );
}