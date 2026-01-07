# Smart-Bin
♻️ SmartBin - AI-Powered Waste Management System
SmartBin is a full-stack MERN application designed to revolutionize waste management. It uses Artificial Intelligence to identify waste types, guides users on proper segregation (Plastic vs. Organic), and incentivizes recycling through a digital wallet and reward point system.

🚀 Features
🤖 AI & Hardware Integration
AI Object Detection: Uses TensorFlow.js (Teachable Machine) to distinguish between Plastic and Organic/General waste in real-time.

Smart Segregation: Dynamically guides users to the correct bin:

🟡 Yellow Bin for Plastic.

🔵 Blue Bin for Organic/Paper.

QR Code Integration: Ensures the user is physically present at a Smart Bin before scanning waste.

💰 Economy & Wallet
Variable Rewards:

Plastic Waste: ₹10 + 50 Eco Points.

Organic Waste: ₹7 + 20 Eco Points.

Digital Wallet: Real-time balance updates and transaction history (Credits & Debits).

Redemption System:

Redeem Eco Points for Movie Vouchers, Bus Passes, and Metro Cards.

Withdraw wallet balance to a bank account.

📊 User Dashboard
Data Visualization: Interactive charts (Recharts) showing "Earnings Trend" and "Waste Distribution".

Activity Logs: Detailed history of every item scanned and reward earned.

🛡️ Admin Command Center
Live Stats: Aggregate view of total users, total money distributed, and CO2 saved.

User Management: Searchable database of all registered users with their wallet statuses.

🛠️ Tech Stack
Frontend: React.js (Vite), Tailwind CSS, Recharts, Lucide React, React Webcam, Axios.

Backend: Node.js.

Database: Firebase (Firestore).

AI/ML: Google Teachable Machine (TensorFlow.js).

Authentication: JWT (JSON Web Tokens) & Bcrypt.

📂 Project Structure

NAAV-BINS/                  # Project Root
│
├── client/                 # Frontend Container
│   │
│   ├── smartbin/           # The Active React + Vite Application
│   │   ├── public/         # Public static assets
│   │   ├── src/            # Main Source Code
│   │   │   ├── assets/     # Images and icons
│   │   │   ├── App.css     # General styles
│   │   │   ├── App.jsx     # Main Application Router
│   │   │   ├── index.css   # Tailwind Imports & Global CSS
│   │   │   └── main.jsx    # React Entry Point
│   │   │
│   │   ├── index.html          # HTML Entry Point
│   │   ├── tailwind.config.js  # Tailwind CSS Configuration
│   │   ├── postcss.config.js   # PostCSS Configuration
│   │   ├── vite.config.js      # Vite Bundler Configuration
│   │   └── package.json        # Frontend Dependencies & Scripts
│   │
│   └── package.json        # (Root client dependencies)
│
├── server/                 # Backend Directory
│   ├── index.js            # Main Server, Database & API Logic
│   └── package.json        # Backend Dependencies
│
└── README.md               # Project Documentation

⚙️ Installation & Setup Guide
Follow these steps to run the project locally on your machine.

Prerequisites
Node.js installed.

MongoDB Compass installed and running locally.

Step 1: Setup the Backend (Server)
Open a terminal and navigate to the server folder:

Bash

cd server
Install dependencies:

Bash

npm install
Start the server:

Bash

node index.js
You should see: ✅ Firebase Firestore Connected and ✅ Server running on port 5000 (Firebase Mode).

Step 2: Setup the Frontend (Client)
Open a new terminal and navigate to the client app:

Bash

cd client/smartbin
Install dependencies:

Bash

npm install
Start the React app:

Bash

npm run dev
Open your browser and go to: http://localhost:5173

🧠 How to Configure the AI Model
This project relies on a custom-trained image classification model.

Go to Teachable Machine.

Train a model with two classes:

Class 1: "Plastic" (Bottles, wrappers).

Class 2: "Organic" (Paper, food waste).

Export the model (Upload to Cloud) and copy the URL.

Open client/smartbin/src/Scanner.jsx.

Replace the URL variable with your link:

JavaScript

const URL = "https://teachablemachine.withgoogle.com/models/GRs1e8MV9/";
🔑 Admin Access
To access the Developer Dashboard:

Register a new user on the website.

Open Firebase Console.

Go to Firestore Database -> users.

Find your user and change the role field from "user" to "admin".

Logout and Login again to access the Admin Portal.

🔮 Future Improvements
Hardware Integration: Connect with Arduino/Raspberry Pi to physically open bin lids based on AI results.

Leaderboard: Global ranking of top recyclers.

Payment Gateway: Integrate Stripe/Razorpay for real money withdrawals.