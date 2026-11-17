import axios from 'axios';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://naav-bins.onrender.com').replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // the free Render instance can take ~30s to wake up
});

// Attach the session token to every request automatically.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers['x-access-token'] = token;
  return config;
});

// Human-readable message from an API error (server message when available).
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const data = err?.response?.data;
  return data?.error || data?.message || (err?.response ? fallback : 'Server connection error. Please try again.');
}

export function apiStatus(err) {
  return err?.response?.status;
}

// Reads the (unverified) token payload for UI decisions only — the server always re-verifies.
export function getSession() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    // Only drop tokens that are clearly expired; the server remains the authority on validity.
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) throw new Error('expired');
    return { email: payload.email, role: payload.role };
  } catch {
    localStorage.removeItem('token');
    return null;
  }
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('current_bin_location');
}

export default api;
