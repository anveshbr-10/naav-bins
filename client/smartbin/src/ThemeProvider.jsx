import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, readStoredTheme, storeTheme } from './themeContext';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

// Applies the theme as a class on <html>. index.html sets the same class before React loads,
// so the page never flashes the wrong theme.
export default function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const mq = media();
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0c1311' : '#15803d');
  }, [resolved]);

  const setTheme = useCallback((t) => { storeTheme(t); setThemeState(t); }, []);
  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
