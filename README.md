# Naav Bins

Naav Bins is a full-stack smart waste management platform that helps users recycle more responsibly and earn rewards for doing so. The app combines AI-based waste identification, card-based eco incentives, nearby bin discovery, and a simple admin dashboard for monitoring impact.

## Overview

This repository contains a React + Vite frontend and a Node.js + Express backend. The app is designed around a recycling workflow:

1. User registers or logs in
2. User finds a nearby smart bin on the map
3. User scans a QR code at the bin
4. Camera-based AI identifies the waste type
5. System updates wallet balance and eco points
6. User can redeem rewards or review leaderboard and impact data

The backend authenticates users with Firebase and stores user profile and rewards data in Supabase.

## Features

- Smart-bin QR flow with location-based scan initiation
- AI waste classification using TensorFlow.js + Teachable Machine
- Wallet and eco-point tracking
- Redemption system for money and points
- Personal dashboard with charts and logs
- Leaderboard for top eco-conscious users
- Nearby bin map using Leaflet
- Admin portal for viewing registered users and impact metrics
- Waste type reward guide for Plastic, Metal, Paper/Cardboard, Organic, Glass, and Other Trash

## Tech Stack

### Frontend
- React 19
- Vite
- Tailwind CSS
- React Router
- Recharts
- Leaflet + React Leaflet
- Lucide React
- React Webcam
- html5-qrcode
- Axios

### Backend
- Node.js
- Express.js
- JWT authentication
- bcryptjs
- Firebase Admin SDK
- Firestore
- Supabase JS client

### AI / ML
- TensorFlow.js
- Teachable Machine

## Project Structure

```text
naav-bins/
├── client/
│   └── smartbin/
│       ├── public/
│       ├── src/
│       ├── index.html
│       ├── package.json
│       ├── vite.config.js
│       ├── tailwind.config.js
│       └── postcss.config.js
├── server/
│   ├── index.js
│   ├── package.json
│   └── serviceAccountKey.json
├── package.json
├── README.md
├── .gitignore
└── todos.txt
```

## Core App Flow

### User Journey
- Register via `/register`
- Login via `/login`
- Open `/dashboard` to see wallet, eco points, charts, and redemption options
- Open `/map` to locate nearby bins
- Open `/scan` to complete QR + AI-driven waste validation
- View leaderboard via `/leaderboard`

### Admin Journey
- Admin users can visit `/admin`
- The portal summarizes total users, distributed funds, and estimated CO2 savings
- Admins can search and inspect user profiles

## Backend API

The backend exposes these main endpoints:

```text
POST /api/register
POST /api/login
GET  /api/dashboard
POST /api/add-waste
POST /api/redeem
GET  /api/admin/users
GET  /api/bins
GET  /api/leaderboard
```

The server uses Firebase Auth-like credential storage in Firestore and Supabase for user profile and reward data. The authentication middleware expects a JWT in the `x-access-token` header.

## Prerequisites

Before running the project locally, ensure you have:

- Node.js 18+
- npm
- Firebase project with a service account
- Supabase project and API keys
- A Teachable Machine model URL for the scanner

## Local Setup

### 1) Install backend dependencies

```bash
cd server
npm install
```

### 2) Configure Firebase and Supabase

Create a Firebase service account JSON file in `server/serviceAccountKey.json` or set the following environment variable:

```bash
FIREBASE_CREDS='{"type":"service_account", ... }'
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-supabase-anon-key"
PORT=5000
```

The backend will also fall back to `server/serviceAccountKey.json` if `FIREBASE_CREDS` is not present.

### 3) Start the backend

```bash
cd server
node index.js
```

You should see a Firebase and Supabase connection message, followed by the backend listening on the configured port.

### 4) Install frontend dependencies

```bash
cd client/smartbin
npm install
```

### 5) Start the frontend

```bash
cd client/smartbin
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Important Note for Local Development

The frontend currently points to the deployed Render API URL:

```text
https://smartbin-api-c7g4.onrender.com
```

If you want to run the complete app locally, update the API URLs in the frontend files under `client/smartbin/src/` to point to your local backend (for example `http://localhost:5000`).

## AI Model Configuration

The scanner uses a Teachable Machine model hosted at a public URL in the frontend:

```js
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/SbH77oNkD/";
```

This model is expected to classify items into labels such as:

- Plastic
- Metal
- Paper / Cardboard
- Organic
- Glass
- Other Trash

If you want to use your own model, replace the URL in `client/smartbin/src/scanner.jsx`.

## Admin Access

To turn a user into an admin:

1. Register a user
2. Open the Firebase Firestore `users` collection
3. Find the user document matching their email
4. Change `role` from `user` to `admin`
5. Log out and log back in

## Usage Example

```text
1. Register a user account
2. Visit the dashboard
3. Find a nearby bin on the map
4. Scan the QR code
5. Capture a recyclable item with the camera
6. The app identifies the material and awards points
7. View rewards, redeem them, or check leaderboard rankings
```

## Future Improvements

- Add more waste categories and better ML accuracy
- Support automated bin lid handling and hardware integration
- Expand gamification with badges and challenge-based rewards
- Add payment integrations for withdrawal flows
- Improve map analytics and location-based smart-bin optimization

## License

This repository does not currently declare a formal license.

## Notes

This project is intended as a smart-city and sustainability prototype for educational, hackathon, or MVP use. It demonstrates how AI, incentives, and local civic technology can be combined to encourage better waste segregation behavior.
