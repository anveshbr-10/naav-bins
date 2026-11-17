import { createContext, useContext } from 'react';

// English / ಕನ್ನಡ / हिन्दी.
//
// English text is the key: write t('Scan a bin') in components. For text defined outside a component
// (constant tables), wrap it in tk('...') so the sync script finds it, then call t(value) at render.
// Placeholders use {name}: t('Hello, {name}!', { name }).
//
// The dictionaries (src/locales/kn.json, hi.json) are kept in sync with the code automatically:
//   npm run i18n         extract new strings, drop unused ones, machine-translate missing ones
//                        (when a translation API key is configured; see scripts/i18n-sync.mjs)
//   npm run i18n:check   fail if any string has no Kannada or Hindi translation (runs in CI and tests)
// `npm run dev` and `npm run build` run the sync first, and the dev server re-runs it whenever a
// source file changes. A string that is not translated yet falls back to English, so nothing breaks.

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

const dictionaries = { en: {} };
let current = 'en';

export function setDictionary(lang, dict) { dictionaries[lang] = dict; }
export function hasDictionary(lang) { return Boolean(dictionaries[lang]); }
export function setCurrentLanguage(lang) { current = lang; }
export function currentLanguage() { return current; }

function interpolate(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

// Translate into the current language (usable anywhere, also outside React).
export function translate(key, params) {
  if (typeof key !== 'string') return '';
  const dict = dictionaries[current];
  const text = (dict && Object.prototype.hasOwnProperty.call(dict, key) && dict[key]) || key;
  return interpolate(text, params);
}

// Marks a string for translation without translating it (for constants); translate it at render time.
export function tk(key) {
  return key;
}

// Localised field of a database row carrying { labels: { kn: {...}, hi: {...} } } (or { labels: { kn: '...' } }
// for a name). Falls back to the English column.
export function localized(row, field, lang = current) {
  if (!row) return '';
  const l = row.labels && row.labels[lang];
  if (typeof l === 'string') return field === 'name' && l ? l : row[field] ?? '';
  if (l && typeof l === 'object' && l[field]) return l[field];
  return row[field] ?? '';
}

export const I18nContext = createContext(null);

// { lang, setLang, t, ready }
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
