import axios from 'axios';
import { supabase } from './supabase';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://naav-bins.onrender.com').replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // the free Render instance can take ~30s to wake up
});

// Attach the current Supabase access token (refreshed automatically when it is about to expire).
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
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

export default api;
