import { createContext, useContext } from 'react';

export const ThemeContext = createContext(null);

const STORAGE_KEY = 'naav-theme';

// 'light' | 'dark' | 'system'
export function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* storage blocked: the choice lasts for this visit only */ }
}

// { theme: 'light'|'dark'|'system', resolved: 'light'|'dark', setTheme, toggle }
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
