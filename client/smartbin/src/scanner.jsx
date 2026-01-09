import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import * as tmImage from '@teachablemachine/image';
import Webcam from 'react-webcam';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Loader2, ScanQrCode, Camera, ArrowRight } from 'lucide-react'; // Added icons

export default function Scanner() {
  const [step, setStep] = useState(1); // 1 = QR, 2 = AI
  const [status, setStatus] = useState("Waiting for waste...");
  const [instruction, setInstruction] = useState("");
  const [borderColor, setBorderColor] = useState("border-gray-500");
  const [isProcessing, setIsProcessing] = useState(false);
  const webcamRef = useRef(null);
  const navigate = useNavigate();

  // --- CAMERA CONFIG ---
  const videoConstraints = {
    width: 400,
    height: 400,
    facingMode: "environment"
  };

  const URL = "https://teachablemachine.withgoogle.com/models/GRs1e8MV9/";

  useEffect(() => {
    if (step === 1) {
      // Config for smoother scanning
      const scanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: 250,
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true
      }, false);

      scanner.render((text) => {
        scanner.clear();
        setStep(2);
      }, (err) => {
        console.log(err); // Keep console clean
      });
      return () => scanner.clear().catch(e => console.log(e));
    }
  }, [step]);

  const capture = async () => {
    // 1. BLOCK MULTIPLE CLICKS
    if (!webcamRef.current || isProcessing) return;

    // 2. LOCK THE BUTTON
    setIsProcessing(true);
    setStatus("Analyzing...");
    setInstruction("");
    setBorderColor("border-gray-500");

    try {
      const model = await tmImage.load(URL + "model.json", URL + "metadata.json");
      const imageSrc = webcamRef.current.getScreenshot();
      const img = new Image();
      img.src = imageSrc;

      img.onload = async () => {
        const prediction = await model.predict(img);
        const bestPrediction = prediction.sort((a, b) => b.probability - a.probability)[0];

        // 3. SUCCESS CASE (Keep Locked)
        if (bestPrediction.probability > 0.80) {

          let wasteType = "Non-Plastic";
          let binColor = "Blue";
          let cssColor = "border-blue-600";
          let userMsg = "Non-Plastic Detected";

          if (bestPrediction.className === "Plastic" || bestPrediction.className === "Class 1") {
            wasteType = "Plastic";
            binColor = "Yellow";
            cssColor = "border-yellow-500";
            userMsg = "Plastic Detected";
          }

          setStatus(`✅ ${userMsg}`);
          setInstruction(`👉 Please dispose in the ${binColor.toUpperCase()} BIN`);
          setBorderColor(cssColor);

          // --- SUBMIT TO SERVER ---
          // We wait 3 seconds so the user can read the instruction before leaving the page
          setTimeout(async () => {
            await axios.post('https://smartbin-api-c7g4.onrender.com/api/add-waste', {
              wasteType: wasteType // Send "Plastic" or "Non-Plastic"
            }, {
              headers: { 'x-access-token': localStorage.getItem('token') }
            });
            alert(`Reward Added! (${wasteType})`);
            navigate('/dashboard');
          }, 3000);

        } else {
          setStatus("❌ Not clear. Please hold the item closer.");
          setBorderColor("border-red-500");
          setIsProcessing(false);
        }
      }
    } catch (e) {
      alert("Model Error: Check your URL.");
      setIsProcessing(false);
    }
  };


  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-4 pt-8 font-sans">

      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-emerald-500/20 rounded-xl">
          <ScanQrCode className="text-emerald-400 w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Smart Bin Scanner</h1>
          <p className="text-slate-400 text-sm">Scan > Identify > Earn</p>
        </div>
      </div>

      {/* --- STEP 1: QR SCANNER (Redesigned) --- */}
      {step === 1 && (
        <div className="w-full max-w-md animate-fade-in-up">

          {/* INSTRUCTIONS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl mb-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500"></div>
            <h2 className="text-lg font-semibold text-white mb-2">Locate a Smart Bin</h2>
            <p className="text-slate-400 text-sm mb-6">Point your camera at the QR code sticker on the bin to connect.</p>

            {/* THE READER CONTAINER */}
            <div className="bg-black rounded-xl overflow-hidden border-2 border-dashed border-slate-700 relative">
              <div id="reader" className="w-full"></div>
            </div>

            <p className="text-xs text-slate-500 mt-4 flex items-center justify-center gap-1">
              <Camera size={14} /> Camera permission required
            </p>
          </div>

          {/* CSS OVERRIDES FOR THE QR LIBRARY */}
          <style>{`
                /* Hide the annoying 'HTML5 QR Code' text link */
                #reader__dashboard_section_csr span { display: none !important; }
                
                /* Style the buttons generated by the library */
                #reader__dashboard_section_csr button {
                    background-color: #10b981 !important; /* Emerald 500 */
                    color: white !important;
                    border: none !important;
                    padding: 10px 20px !important;
                    border-radius: 99px !important;
                    font-weight: bold !important;
                    cursor: pointer !important;
                    margin-top: 10px !important;
                }
                
                /* Hide the ugly borders of the library */
                #reader { border: none !important; }
                
                /* Fix the video container size */
                #reader video { 
                    border-radius: 12px !important; 
                    object-fit: cover !important;
                }
            `}</style>
        </div>
      )}

      {/* --- STEP 2: AI ANALYZER (Functionality Preserved) --- */}
      {step === 2 && (
        <div className="flex flex-col items-center w-full max-w-md animate-fade-in-up">
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-2xl w-full mb-4">
            <div className="flex justify-between items-center px-4 py-2">
              <span className="text-emerald-400 font-bold text-sm flex items-center gap-2">● Connected</span>
              <span className="text-slate-500 text-xs uppercase tracking-wider">AI Ready</span>
            </div>
          </div>

          {/* Dynamic Border Color changes based on waste type */}
          <div className={`relative border-4 ${borderColor} rounded-2xl overflow-hidden w-full shadow-2xl transition-all duration-300`}>
            <Webcam
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={videoConstraints}
              className="w-full object-cover h-96"
            />

            {/* Scanner Overlay Line */}
            {isProcessing && (
              <div className="absolute top-0 left-0 w-full h-1 bg-white shadow-[0_0_20px_white] animate-scan-down"></div>
            )}
          </div>

          {/* CSS Animation for the scanner line */}
          <style>{`
            @keyframes scan-down {
                0% { top: 0%; opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { top: 100%; opacity: 0; }
            }
            .animate-scan-down {
                animation: scan-down 2s linear infinite;
            }
          `}</style>

          <div className="mt-6 text-center w-full">
            <p className="text-xl font-bold text-white mb-4">{status}</p>

            {instruction && (
              <div className={`p-6 rounded-2xl ${instruction.includes("YELLOW") ? "bg-yellow-400 text-black shadow-yellow-500/20" : "bg-blue-600 text-white shadow-blue-500/20"} shadow-lg animate-bounce`}>
                <h2 className="text-2xl font-extrabold tracking-tight">{instruction}</h2>
              </div>
            )}
          </div>

          {!instruction && (
            <button
              onClick={capture}
              disabled={isProcessing}
              className={`mt-6 w-full py-4 rounded-xl text-lg font-bold shadow-lg flex items-center justify-center gap-3 transition-all transform
                    ${isProcessing
                  ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:scale-[1.02] active:scale-95 shadow-emerald-500/30"}`
              }
            >
              {isProcessing ? (
                <><Loader2 className="animate-spin" /> Analyzing Waste...</>
              ) : (
                <><Camera /> Capture & Analyze</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}