import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function Admin() {
    const [users, setUsers] = useState([]);
    useEffect(() => {
        axios.get('http://localhost:5000/api/admin/users').then(res => setUsers(res.data.users));
    }, []);

    return (
        <div className="p-10 bg-gray-50 min-h-screen">
            <h1 className="text-3xl font-bold mb-8">Developer Logs</h1>
            <div className="overflow-x-auto bg-white rounded-lg shadow">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-800 text-white">
                            <th className="p-4 border-b">User Name</th>
                            <th className="p-4 border-b">Email</th>
                            <th className="p-4 border-b">Wallet</th>
                            <th className="p-4 border-b">Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u._id} className="hover:bg-gray-100 border-b">
                                <td className="p-4">{u.name}</td>
                                <td className="p-4 text-sm text-gray-500">{u.email}</td>
                                <td className="p-4 font-bold text-green-600">₹{u.walletBalance}</td>
                                <td className="p-4 text-blue-600">{u.ecoPoints}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}