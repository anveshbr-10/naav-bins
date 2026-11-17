import axios from 'axios';
import { supabase } from './supabase';
import { translate, tk } from './i18n';

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

// Human-readable message from an API error, in the user's language. The API sends the English
// template and its parameters ({ i18n: { key, params } }). Callers pass fallbacks wrapped in tk('…').
export function apiErrorMessage(err, fallback = tk('Something went wrong. Please try again.')) {
  const data = err?.response?.data;
  if (data?.i18n?.key) return translate(data.i18n.key, data.i18n.params || undefined);
  if (data?.error || data?.message) return translate(data.error || data.message);
  return err?.response ? translate(fallback) : translate(tk('Server connection error. Please try again.'));
}

export function apiStatus(err) {
  return err?.response?.status;
}

export default api;
