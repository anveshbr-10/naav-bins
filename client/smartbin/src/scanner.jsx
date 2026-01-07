import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import * as tmImage from '@teachablemachine/image';
import Webcam from 'react-webcam';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Scanner() {
  const [step, setStep] = useState(1); // 1 = QR, 2 = AI
  const [status, setStatus] = useState("Waiting for waste...");
  const [instruction, setInstruction] = useState(""); // Stores "Yellow Bin" or "Blue Bin"
  const [borderColor, setBorderColor] = useState("border-gray-500"); // Dynamic border color
  const webcamRef = useRef(null);
  const navigate = useNavigate();

  // --- CAMERA CONFIG (USE BACK CAMERA) ---
  const videoConstraints = {
    width: 400,
    height: 400,
    facingMode: "environment" // <--- THIS FORCES THE BACK CAMERA
  };

  // --- PASTE YOUR TEACHABLE MACHINE URL BELOW ---
  const URL = "https://teachablemachine.withgoogle.com/models/GRs1e8MV9/";

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
    if (!webcamRef.current) return;
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

        // Find the prediction with the highest probability
        const bestPrediction = prediction.sort((a, b) => b.probability - a.probability)[0];

        if (bestPrediction.probability > 0.80) {

          let wasteType = "Non-Plastic";
          let binColor = "Blue";
          let cssColor = "border-blue-600";
          let userMsg = "Non-Plastic Detected";

          // CHECK IF IT IS PLASTIC (Make sure your Class Name in Teachable Machine is 'Plastic')
          if (bestPrediction.className === "Plastic" || bestPrediction.className === "Class 1") {
            wasteType = "Plastic";
            binColor = "Yellow";
            cssColor = "border-yellow-500";
            userMsg = "Plastic Detected";
          }

          // --- UPDATE UI ---
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
        }
      }
    } catch (e) {
      alert("Model Error: Check your URL.");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-5 pt-10">
      <h1 className="text-2xl font-bold mb-6">Smart Bin Scanner</h1>

      {step === 1 && (
        <div className="bg-white p-6 rounded-lg text-black w-full max-w-md">
          <p className="mb-4 text-center font-bold">Step 1: Scan Bin QR</p>
          <div id="reader"></div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col items-center w-full max-w-md">
          <p className="text-gray-400 mb-2">Connected! Show Waste.</p>

          {/* Dynamic Border Color changes based on waste type */}
          <div className={`border-8 ${borderColor} rounded-lg overflow-hidden w-full transition-all duration-500`}>
            <Webcam
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={videoConstraints} // <--- Forces Back Camera
              className="w-full object-cover h-80"
            />
          </div>

          <div className="mt-6 text-center">
            <p className="text-xl font-bold text-white mb-2">{status}</p>

            {/* BIG INSTRUCTION TEXT */}
            {instruction && (
              <div className={`p-4 rounded-xl ${instruction.includes("YELLOW") ? "bg-yellow-500 text-black" : "bg-blue-600 text-white"} animate-bounce`}>
                <h2 className="text-2xl font-extrabold">{instruction}</h2>
              </div>
            )}
          </div>

          {!instruction && (
            <button onClick={capture} className="mt-6 bg-green-600 active:bg-green-800 px-10 py-4 rounded-full text-xl font-bold shadow-lg">
              Analyze Waste
            </button>
          )}
        </div>
      )}
    </div>
  );
}