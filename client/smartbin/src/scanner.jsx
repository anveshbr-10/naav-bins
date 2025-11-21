import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import * as tmImage from '@teachablemachine/image';
import Webcam from 'react-webcam';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ArrowRightCircle, Trash2 } from 'lucide-react';

export default function Scanner() {
  const [step, setStep] = useState(1); // 1 = QR, 2 = AI
  const [status, setStatus] = useState("Waiting for waste...");
  const [instruction, setInstruction] = useState(null); // { type: "Plastic", color: "YELLOW" }
  const webcamRef = useRef(null);
  const navigate = useNavigate();
  
  // ⚠️ IMPORTANT: PASTE YOUR TEACHABLE MACHINE URL HERE ⚠️
  const URL = "https://teachablemachine.withgoogle.com/models/YOUR_MODEL_ID_HERE/"; 

  useEffect(() => {
    if (step === 1) {
      const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
      scanner.render((text) => {
        scanner.clear();
        setStep(2); // Move to AI
      }, (err) => console.log(err));
      return () => scanner.clear().catch(e => console.log(e));
    }
  }, [step]);

  const capture = async () => {
    if(!webcamRef.current) return;
    setStatus("Analyzing...");
    
    try {
      const model = await tmImage.load(URL + "model.json", URL + "metadata.json");
      const imageSrc = webcamRef.current.getScreenshot();
      const img = new Image();
      img.src = imageSrc;
      
      img.onload = async () => {
        const prediction = await model.predict(img);
        
        // Get the highest probability result
        const bestResult = prediction.sort((a, b) => b.probability - a.probability)[0];

        if (bestResult.probability > 0.80) {
          
          // LOGIC: Segregation & Rewards
          // Check your Teachable Machine Class Name (usually "Plastic" or "Class 1")
          if (bestResult.className === "Plastic" || bestResult.className === "Class 1") {
            // CASE 1: PLASTIC (Yellow Bin, ₹10)
            handleSuccess("Plastic", "YELLOW");
          } else {
            // CASE 2: NON-PLASTIC (Blue Bin, ₹7)
            handleSuccess("Organic", "BLUE");
          }

        } else {
          setStatus("❌ Not clear. Please hold item closer.");
        }
      }
    } catch(e) {
      alert("Model Error: Check your URL.");
    }
  };

  // --- THIS IS THE UPDATED FUNCTION FOR REWARDS ---
  const handleSuccess = async (wasteType, binColor) => {
    // 1. Update UI immediately to show instruction (Yellow/Blue)
    setInstruction({ type: wasteType, color: binColor });
    setStatus("✅ Detected!");

    try {
      // 2. Send data to backend
      const res = await axios.post('http://localhost:5000/api/add-waste', {
        wasteType: wasteType 
      }, {
          headers: { 'x-access-token': localStorage.getItem('token') }
      });

      // 3. Determine Reward Amount (₹10 for Plastic, ₹7 for others)
      // We try to get it from server response, otherwise calculate locally
      const rewardAmount = res.data.rewardAdded || (wasteType === 'Plastic' ? 10 : 7);

      // 4. Wait 3 seconds so user can read the instruction
      setTimeout(() => {
        alert(`Success! ₹${rewardAmount} added for recycling ${wasteType}.`);
        navigate('/dashboard');
      }, 3000);

    } catch(err) {
      console.error(err);
      alert("Network Error: Could not save reward.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-5 pt-10">
      <div className="flex items-center gap-2 mb-6">
        <Trash2 className="text-green-400" />
        <h1 className="text-2xl font-bold">Smart Bin Scanner</h1>
      </div>
      
      {step === 1 && (
        <div className="bg-white p-8 rounded-2xl text-black w-full max-w-md shadow-2xl">
          <p className="mb-6 text-center font-bold text-lg text-gray-600">Step 1: Scan Bin QR Code</p>
          <div id="reader" className="overflow-hidden rounded-xl"></div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col items-center w-full max-w-md">
          
          {/* DYNAMIC BORDER COLOR */}
          <div className={`relative w-full rounded-2xl overflow-hidden border-8 transition-colors duration-500 ${
            instruction 
              ? (instruction.color === 'YELLOW' ? 'border-yellow-400' : 'border-blue-500') 
              : 'border-gray-700'
          }`}>
             <Webcam ref={webcamRef} screenshotFormat="image/jpeg" className="w-full" />
             
             {/* OVERLAY INSTRUCTION */}
             {instruction && (
               <div className={`absolute bottom-0 left-0 right-0 p-4 text-center animate-pulse ${
                 instruction.color === 'YELLOW' ? 'bg-yellow-400 text-black' : 'bg-blue-600 text-white'
               }`}>
                 <p className="text-sm font-bold uppercase tracking-wider">Dispose in</p>
                 <h2 className="text-3xl font-extrabold">{instruction.color} BIN</h2>
               </div>
             )}
          </div>

          <p className="text-xl font-bold my-6 text-gray-300">{status}</p>
          
          {!instruction && (
            <button 
              onClick={capture} 
              className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white py-4 rounded-xl text-xl font-bold shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2"
            >
              Capture & Analyze <ArrowRightCircle />
            </button>
          )}
        </div>
      )}
    </div>
  );
}