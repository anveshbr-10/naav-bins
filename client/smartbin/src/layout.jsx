import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Home, LayoutDashboard, Map, ScanQrCode, Trophy, Info, LogOut, Moon, Sun, ShieldCheck, Download, Languages, Check, Store,
} from 'lucide-react';
import { useAuth } from './authContext';
import { useTheme } from './themeContext';
import { useI18n, LANGUAGES, tk } from './i18n';
import { useInstallPrompt } from './pwa';
import { Logo, BRAND_NAME, CONTACT_EMAIL } from './brand';
import { BackButton } from './nav';
import { useLogout } from './logout';

export function ThemeToggle({ className = '' }) {
  const { resolved, toggle } = useTheme();
  const { t } = useI18n();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t('Switch to light theme') : t('Switch to dark theme')}
      title={dark ? t('Light theme') : t('Dark theme')}
      className={`p-2 rounded-full text-gray-600 hover:bg-gray-100 transition ${className}`}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

// English / ಕನ್ನಡ / हिन्दी. The choice is remembered on this device.
export function LanguageSwitcher({ className = '', tone = 'default' }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const currentLang = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('Language')}
        title={t('Language')}
        className={`inline-flex items-center gap-1.5 p-2 rounded-full text-sm font-semibold transition ${tone === 'light'
          ? 'text-white hover:bg-white/10'
          : 'text-gray-600 hover:bg-gray-100'}`}
      >
        <Languages size={20} aria-hidden="true" />
        <span className="hidden sm:inline">{currentLang.native}</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={t('Language')} className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
          {LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === lang}
                lang={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <span><span className="font-semibold">{l.native}</span>{l.code !== 'en' && <span className="text-gray-500"> · {l.label}</span>}</span>
                {l.code === lang && <Check size={16} className="text-green-600" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Navigation entries depend on who is signed in.
function useNavItems() {
  const { status, profile } = useAuth();
  const signedIn = status === 'signedIn';
  const role = profile?.role;
  const homeItem = !signedIn
    ? { to: '/', label: tk('Home'), short: tk('Home'), icon: Home, end: true }
    : role === 'admin'
      ? { to: '/admin', label: tk('Operations'), short: tk('Ops'), icon: ShieldCheck }
      : role === 'vendor'
        ? { to: '/counter', label: tk('Counter'), short: tk('Counter'), icon: Store }
        : { to: '/dashboard', label: tk('Dashboard'), short: tk('Home'), icon: LayoutDashboard };
  return {
    signedIn,
    canScan: signedIn && role === 'user',
    items: [
      homeItem,
      { to: '/map', label: tk('Bin Map'), short: tk('Map'), icon: Map },
      { to: '/leagues', label: tk('Leagues'), short: tk('Leagues'), icon: Trophy },
      { to: '/about', label: tk('About'), short: tk('About'), icon: Info },
    ],
  };
}

const desktopLink = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-semibold transition ${isActive
    ? 'text-green-700 bg-green-50'
    : 'text-gray-600 hover:text-green-700 hover:bg-gray-50'}`;

function Navbar() {
  const { t } = useI18n();
  const { signedIn, canScan, items } = useNavItems();
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 pt-[env(safe-area-inset-top)]">
      <nav aria-label={t('Main')} className="max-w-6xl mx-auto flex items-center justify-between gap-2 sm:gap-4 px-4 h-16">
        <div className="flex items-center gap-1 min-w-0">
          <BackButton />
          <Link to="/" aria-label={t('{brand} home', { brand: BRAND_NAME })} className="rounded-lg flex-shrink-0">
            <Logo size={32} />
          </Link>
        </div>

        <ul className="hidden md:flex items-center gap-1">
          {items.map((it) => (
            <li key={it.to}><NavLink to={it.to} end={it.end} className={desktopLink}>{t(it.label)}</NavLink></li>
          ))}
        </ul>

        <div className="flex items-center gap-0.5 sm:gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          {signedIn ? (
            <>
              {canScan && (
                <Link
                  to="/scan"
                  className="hidden md:inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-green-700 transition shadow-sm"
                >
                  <ScanQrCode size={18} /> {t('Scan')}
                </Link>
              )}
              <button
                type="button"
                onClick={logout}
                aria-label={t('Log out')}
                title={t('Log out')}
                className="inline-flex items-center gap-2 p-2 md:px-3 rounded-full text-gray-600 hover:text-red-600 hover:bg-red-50 text-sm font-semibold transition"
              >
                <LogOut size={18} /> <span className="hidden md:inline">{t('Log out')}</span>
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-2 sm:px-3 py-2 rounded-full text-sm font-semibold text-gray-700 hover:text-green-700 transition whitespace-nowrap">
                {t('Log in')}
              </Link>
              <Link
                to="/register"
                className="hidden sm:inline-flex bg-green-600 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-green-700 transition shadow-sm whitespace-nowrap"
              >
                {t('Sign up')}
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

// Thumb-reach navigation on phones. Users get a raised Scan button in the middle.
function BottomNav() {
  const { t } = useI18n();
  const { canScan, items } = useNavItems();
  const [home, map, board, about] = items;
  const tabs = canScan ? [home, map, null, board, about] : [home, map, board, about];

  const tabClass = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 h-full text-[11px] font-semibold transition ${isActive ? 'text-green-700' : 'text-gray-500'}`;

  return (
    <nav
      aria-label={t('Quick navigation')}
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-100 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={`grid h-16 ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {tabs.map((it) =>
          it ? (
            <li key={it.to}>
              <NavLink to={it.to} end={it.end} className={tabClass}>
                <it.icon size={22} aria-hidden="true" />
                <span className="truncate max-w-full px-1">{t(it.short)}</span>
              </NavLink>
            </li>
          ) : (
            <li key="scan" className="flex justify-center">
              <NavLink
                to="/scan"
                aria-label={t('Scan a bin')}
                className="-mt-6 w-16 h-16 rounded-full bg-green-600 text-white shadow-lg shadow-green-600/30 ring-4 ring-white flex items-center justify-center hover:bg-green-700 transition"
              >
                <ScanQrCode size={28} aria-hidden="true" />
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

export function InstallAppButton({ className = '' }) {
  const { canInstall, install } = useInstallPrompt();
  const { t } = useI18n();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={install}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border border-green-200 bg-green-50 text-green-700 text-sm font-bold hover:bg-green-100 transition ${className}`}
    >
      <Download size={16} aria-hidden="true" /> {t('Install the app')}
    </button>
  );
}

function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-gray-100 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-3">
        <div>
          <Logo size={28} textClassName="text-lg" />
          <p className="mt-3 text-sm text-gray-500 max-w-xs">
            {t('Scan. Sort. Earn.')} {t('AI-assisted waste sorting that rewards every correctly binned item.')}
          </p>
          <InstallAppButton className="mt-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3">{t('Explore')}</h2>
          <ul className="space-y-2 text-sm">
            <li><Link to="/map" className="text-gray-600 hover:text-green-700">{t('Find a bin')}</Link></li>
            <li><Link to="/leagues" className="text-gray-600 hover:text-green-700">{t('Campus leagues')}</Link></li>
            <li><Link to="/about" className="text-gray-600 hover:text-green-700">{t('About us')}</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3">{t('Contact')}</h2>
          <ul className="space-y-2 text-sm">
            <li><a href={`mailto:${CONTACT_EMAIL}`} className="text-gray-600 hover:text-green-700 break-all">{CONTACT_EMAIL}</a></li>
            <li><Link to="/about#contact" className="text-gray-600 hover:text-green-700">{t('Send us a message')}</Link></li>
          </ul>
        </div>
      </div>
      <p className="border-t border-gray-100 py-4 text-center text-xs text-gray-500">
        © {year} {BRAND_NAME}. {t('Built at Dr. Ambedkar Institute of Technology, Bengaluru.')}
      </p>
    </footer>
  );
}

// Shared page frame: skip link, navbar, page content, footer and the phone bottom bar.
// fullHeight: the page fills the viewport below the navbar (map, scanner) and has no footer.
export default function AppShell({ children, footer = true, fullHeight = false, className = '' }) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-col bg-gray-50 ${fullHeight ? 'h-dvh' : 'min-h-dvh'}`}>
      <a href="#main" className="skip-link">{t('Skip to content')}</a>
      <Navbar />
      <main
        id="main"
        tabIndex={-1}
        className={`flex-1 outline-none ${fullHeight ? 'min-h-0 flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0' : ''} ${className}`}
      >
        {children}
      </main>
      {footer && !fullHeight && <Footer />}
      {!fullHeight && <div className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />}
      <BottomNav />
    </div>
  );
}
