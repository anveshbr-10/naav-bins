import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// --- FIX ICONS (Native Leaflet requires manual icon setup) ---
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

export default function SmartBinMap() {
    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null); // Keep track of map to prevent double-loading
    const navigate = useNavigate();
    const [activeLayer, setActiveLayer] = useState("Satellite");

    // --- CONFIG: YOUR BIN LOCATIONS ---
    const centerPosition = [12.963695293135315, 77.50602831316505];
    const bins = [
        { id: 1, name: "Main Building Bin", lat: 12.963695293135315, lng: 77.50602831316505, status: "Active" },
        { id: 2, name: "Sports Complex Bin", lat: 12.965048774554218, lng: 77.50595464214099, status: "Active" },
        { id: 3, name: "Rock Garden Bin", lat: 12.964168121389369, lng: 77.5054484020979, status: "Bin Full" },
    ];

    useEffect(() => {
        // 1. Initialize Map ONLY ONCE
        if (!mapInstanceRef.current && mapContainerRef.current) {

            // Create Map
            const map = L.map(mapContainerRef.current).setView(centerPosition, 18);
            mapInstanceRef.current = map;

            // Add Satellite Layer (Default)
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri'
            }).addTo(map);

            // Add Pins
            bins.forEach(bin => {
                const marker = L.marker([bin.lat, bin.lng]).addTo(map);

                // Create a Custom Popup HTML
                const popupContent = document.createElement('div');
                popupContent.innerHTML = `
                <div style="text-align: center; font-family: sans-serif;">
                    <h3 style="margin: 0; font-weight: bold; font-size: 16px;">${bin.name}</h3>
                    <span style="background-color: ${bin.status === 'Full' ? '#ef4444' : '#10b981'}; color: white; padding: 2px 8px; border-radius: 99px; font-size: 12px; font-weight: bold;">
                        ${bin.status}
                    </span>
                    <br/>
                    <button id="scan-btn-${bin.id}" style="margin-top: 8px; background-color: #059669; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Scan Here
                    </button>
                </div>
            `;

                // Add click listener to the button inside popup
                popupContent.querySelector(`#scan-btn-${bin.id}`).addEventListener('click', () => {
                    // 1. Save the name to Browser Memory (LocalStorage)
                    localStorage.setItem('current_bin_location', bin.name);
                    console.log("Location Saved:", bin.name); // Debug log

                    // 2. Go to Scanner
                    navigate('/scan');
                });

                marker.bindPopup(popupContent);
            });
        }

        // Cleanup when leaving page
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []);

    return (
        <div className="h-screen w-full flex flex-col relative bg-slate-900">

            {/* HEADER OVERLAY */}
            <div className="absolute top-4 left-4 right-4 z-[1000] bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/dashboard')} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition">
                        <ArrowLeft className="text-slate-700" size={24} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">Smart Bin Locations</h1>
                        <p className="text-xs text-slate-500">Live Satellite Feed</p>
                    </div>
                </div>
            </div>

            {/* MAP CONTAINER (Reference Point) */}
            <div ref={mapContainerRef} className="h-full w-full z-0" />

        </div>
    );
}