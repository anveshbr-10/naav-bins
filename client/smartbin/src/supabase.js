import { createClient } from '@supabase/supabase-js';
import { translate, tk } from './i18n';

// Public values: the project URL and the *publishable* key are designed to be shipped to browsers.
// Every table is protected by Row Level Security; the browser only talks to Supabase Auth.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://chqznpoidwgoptxlzxwo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_F_F1cVmxBzRdl8SDYg_RCg_yNZTYfAg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // completes email-confirmation, password-reset and social-login redirects
  },
});

export const AUTH_REDIRECTS = {
  callback: () => `${window.location.origin}/auth/callback`,
  resetPassword: () => `${window.location.origin}/reset-password`,
};

// Social providers shown on the sign-in screen (Supabase provider ids).
export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google', icon: 'fab fa-google' },
  { id: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-f' },
  { id: 'linkedin_oidc', label: 'LinkedIn', icon: 'fab fa-linkedin-in' },
];

// Which providers are switched on in the Supabase dashboard (public endpoint), fetched once.
let providerSettingsPromise = null;
export function getEnabledProviders() {
  if (!providerSettingsPromise) {
    providerSettingsPromise = fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('settings unavailable'))))
      .then((settings) => settings.external || {})
      .catch((err) => { providerSettingsPromise = null; throw err; });
  }
  return providerSettingsPromise;
}

// Friendly text for Supabase Auth errors, in the user's language.
export function authErrorMessage(error, fallback = tk('Something went wrong. Please try again.')) {
  if (!error) return translate(fallback);
  const code = error.code || '';
  const map = {
    invalid_credentials: tk('Invalid email or password.'),
    email_not_confirmed: tk('Please confirm your email address first. Check your inbox for the link.'),
    user_already_exists: tk('An account with this email already exists. Please sign in.'),
    weak_password: tk('That password is too weak. Use at least 8 characters with letters and numbers.'),
    over_email_send_rate_limit: tk('We have sent several emails to this address recently. Please check your inbox and spam folder, or try again in a few minutes.'),
    over_request_rate_limit: tk('Too many attempts. Please wait a moment and try again.'),
    same_password: tk('Your new password must be different from the old one.'),
    otp_expired: tk('This link has expired. Please request a new one.'),
  };
  if (map[code]) return translate(map[code]);
  if (/invalid login credentials/i.test(error.message || '')) return translate(map.invalid_credentials);
  if (/email not confirmed/i.test(error.message || '')) return translate(map.email_not_confirmed);
  return error.message || translate(fallback);
}
