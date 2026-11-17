import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from './authContext';
import { useI18n } from './i18n';

// React Router keeps the position of each page in this tab's history at history.state.idx
// (0 = the first page of the site the visitor opened in this tab).
const historyIndex = () => window.history.state?.idx ?? 0;

// In-app Back: the previous page if it was on this site, otherwise the visitor's home page,
// so the button never leaves the site or depends on the browser's own back control.
export function BackButton({ tone = 'default', className = '' }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { home } = useAuth();
  const { t } = useI18n();
  if (pathname === '/') return null;
  const goBack = () => {
    if (historyIndex() > 0) navigate(-1);
    else navigate(home && home !== pathname ? home : '/', { replace: true });
  };
  const toneClass = tone === 'light' ? 'text-white hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100 hover:text-green-700';
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t('Back')}
      title={t('Back')}
      className={`inline-flex items-center gap-1 p-2 rounded-full text-sm font-semibold transition flex-shrink-0 ${toneClass} ${className}`}
    >
      <ArrowLeft size={20} aria-hidden="true" />
    </button>
  );
}
