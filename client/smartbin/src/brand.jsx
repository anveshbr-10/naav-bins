import React, { useId } from 'react';

// The product has one name. Use BRAND_NAME in copy instead of typing it.
export const BRAND_NAME = 'Naav Bins';
export const BRAND_TAGLINE = 'Scan. Sort. Earn.';
export const CONTACT_EMAIL = 'naavhackers@gmail.com';

// Logo mark: a bin with a leaf. Same artwork as public/logo.svg (favicon) and the PWA icons.
export function LogoMark({ size = 32, className = '' }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`flex-shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <rect x="15" y="16" width="34" height="6" rx="3" fill="#fff" />
      <rect x="27" y="11" width="10" height="6" rx="2" fill="#fff" />
      <path d="M18 25h28l-2.8 30H20.8z" fill="#fff" />
      <path d="M25 47A12 12 0 0 1 39 33A12 12 0 0 1 25 47z" fill="#16a34a" />
      <path d="M27 45L37 35" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// tone="light" is for dark or coloured backgrounds.
export function Logo({ size = 32, className = '', textClassName = 'text-xl', tone = 'default' }) {
  const light = tone === 'light';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className={`font-extrabold tracking-tight ${light ? 'text-white' : 'text-gray-900'} ${textClassName}`}>
        Naav <span className={light ? 'text-green-300' : 'text-green-600'}>Bins</span>
      </span>
    </span>
  );
}
