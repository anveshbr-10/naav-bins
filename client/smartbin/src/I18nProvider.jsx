import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  I18nContext, LANGUAGE_CODES, translate, setDictionary, hasDictionary, setCurrentLanguage,
} from './i18n';

const STORAGE_KEY = 'naav-lang';
const LOADERS = {
  kn: () => import('./locales/kn.json'),
  hi: () => import('./locales/hi.json'),
};
// Web fonts so Kannada and Devanagari render well on every desktop (phones ship them already).
const FONTS = {
  kn: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;600;700;800&display=swap',
  hi: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700;800&display=swap',
};

function readStoredLanguage() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGE_CODES.includes(v)) return v;
  } catch { /* storage blocked */ }
  const browser = String(navigator.language || '').slice(0, 2);
  return LANGUAGE_CODES.includes(browser) ? browser : 'en';
}

function loadDictionary(code) {
  if (hasDictionary(code)) return Promise.resolve();
  return LOADERS[code]().then((mod) => setDictionary(code, mod.default || mod));
}

function loadFont(lang) {
  if (!FONTS[lang] || document.querySelector(`link[data-font="${lang}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONTS[lang];
  link.dataset.font = lang;
  document.head.appendChild(link);
}

export default function I18nProvider({ children }) {
  const [lang, setLangState] = useState('en');
  const [ready, setReady] = useState(false);

  // Loads the dictionary first; if it cannot be downloaded the current language stays.
  const apply = useCallback((next) => {
    const code = LANGUAGE_CODES.includes(next) ? next : 'en';
    return loadDictionary(code).then(() => {
      setCurrentLanguage(code);
      document.documentElement.lang = code;
      loadFont(code);
      setLangState(code);
    }, () => {});
  }, []);

  useEffect(() => {
    let active = true;
    apply(readStoredLanguage()).then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [apply]);

  const setLang = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked: this visit only */ }
    apply(next);
  }, [apply]);

  // `t` gets a new identity per language so every consumer re-renders when the language changes.
  const value = useMemo(() => ({
    lang,
    ready,
    setLang,
    t: (key, params) => translate(key, params),
  }), [lang, ready, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
