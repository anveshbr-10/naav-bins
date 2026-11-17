import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Home, LayoutDashboard, Map, ScanQrCode, Trophy, Info, LogOut, Moon, Sun, ShieldCheck, Download,
} from 'lucide-react';
import { useAuth } from './authContext';
import { useTheme } from './themeContext';
import { useInstallPrompt } from './pwa';
import { Logo, BRAND_NAME, BRAND_TAGLINE, CONTACT_EMAIL } from './brand';

export function ThemeToggle({ className = '' }) {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={`p-2 rounded-full text-gray-600 hover:bg-gray-100 transition ${className}`}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

// Navigation entries depend on who is signed in.
function useNavItems() {
  const { status, profile } = useAuth();
  const signedIn = status === 'signedIn';
  const isAdmin = profile?.role === 'admin';
  const homeItem = !signedIn
    ? { to: '/', label: 'Home', icon: Home, end: true }
    : isAdmin
      ? { to: '/admin', label: 'Admin', icon: ShieldCheck }
      : { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
  return {
    signedIn,
    isAdmin,
    items: [
      homeItem,
      { to: '/map', label: 'Bin Map', icon: Map },
      { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      { to: '/about', label: 'About', icon: Info },
    ],
  };
}

const desktopLink = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm font-semibold transition ${isActive
    ? 'text-green-700 bg-green-50'
    : 'text-gray-600 hover:text-green-700 hover:bg-gray-50'}`;

function Navbar() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { signedIn, isAdmin, items } = useNavItems();

  const logout = async () => { await signOut(); navigate('/'); };

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 pt-[env(safe-area-inset-top)]">
      <nav aria-label="Main" className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-4 h-16">
        <Link to="/" aria-label={`${BRAND_NAME} home`} className="rounded-lg">
          <Logo size={32} />
        </Link>

        <ul className="hidden md:flex items-center gap-1">
          {items.map((it) => (
            <li key={it.to}><NavLink to={it.to} end={it.end} className={desktopLink}>{it.label}</NavLink></li>
          ))}
        </ul>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {signedIn ? (
            <>
              {!isAdmin && (
                <Link
                  to="/scan"
                  className="hidden md:inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-green-700 transition shadow-sm"
                >
                  <ScanQrCode size={18} /> Scan
                </Link>
              )}
              <button
                type="button"
                onClick={logout}
                aria-label="Log out"
                title="Log out"
                className="inline-flex items-center gap-2 p-2 md:px-3 rounded-full text-gray-600 hover:text-red-600 hover:bg-red-50 text-sm font-semibold transition"
              >
                <LogOut size={18} /> <span className="hidden md:inline">Log out</span>
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-3 py-2 rounded-full text-sm font-semibold text-gray-700 hover:text-green-700 transition">
                Log in
              </Link>
              <Link
                to="/register"
                className="hidden sm:inline-flex bg-green-600 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-green-700 transition shadow-sm"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

// Thumb-reach navigation on phones. Signed-in users get a raised Scan button in the middle.
function BottomNav() {
  const { signedIn, isAdmin, items } = useNavItems();
  const [home, map, board, about] = items;
  const showScan = signedIn && !isAdmin;
  const tabs = showScan ? [home, map, null, board, about] : [home, map, board, about];

  const tabClass = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 h-full text-[11px] font-semibold transition ${isActive ? 'text-green-700' : 'text-gray-500'}`;

  return (
    <nav
      aria-label="Quick navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-100 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={`grid h-16 ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {tabs.map((it) =>
          it ? (
            <li key={it.to}>
              <NavLink to={it.to} end={it.end} className={tabClass}>
                <it.icon size={22} aria-hidden="true" />
                {it.label === 'Leaderboard' ? 'Ranks' : it.label === 'Bin Map' ? 'Map' : it.label}
              </NavLink>
            </li>
          ) : (
            <li key="scan" className="flex justify-center">
              <NavLink
                to="/scan"
                aria-label="Scan a bin"
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
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={install}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border border-green-200 bg-green-50 text-green-700 text-sm font-bold hover:bg-green-100 transition ${className}`}
    >
      <Download size={16} aria-hidden="true" /> Install the app
    </button>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-gray-100 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-3">
        <div>
          <Logo size={28} textClassName="text-lg" />
          <p className="mt-3 text-sm text-gray-500 max-w-xs">
            {BRAND_TAGLINE} AI-assisted waste sorting that rewards every correctly binned item.
          </p>
          <InstallAppButton className="mt-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3">Explore</h2>
          <ul className="space-y-2 text-sm">
            <li><Link to="/map" className="text-gray-600 hover:text-green-700">Find a bin</Link></li>
            <li><Link to="/leaderboard" className="text-gray-600 hover:text-green-700">Leaderboard</Link></li>
            <li><Link to="/about" className="text-gray-600 hover:text-green-700">About us</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3">Contact</h2>
          <ul className="space-y-2 text-sm">
            <li><a href={`mailto:${CONTACT_EMAIL}`} className="text-gray-600 hover:text-green-700 break-all">{CONTACT_EMAIL}</a></li>
            <li><Link to="/about#contact" className="text-gray-600 hover:text-green-700">Send us a message</Link></li>
          </ul>
        </div>
      </div>
      <p className="border-t border-gray-100 py-4 text-center text-xs text-gray-500">
        © {year} {BRAND_NAME}. Built at Dr. Ambedkar Institute of Technology, Bengaluru.
      </p>
    </footer>
  );
}

// Shared page frame: skip link, navbar, page content, footer and the phone bottom bar.
// fullHeight: the page fills the viewport below the navbar (map, scanner) and has no footer.
export default function AppShell({ children, footer = true, fullHeight = false, className = '' }) {
  return (
    <div className={`flex flex-col bg-gray-50 ${fullHeight ? 'h-dvh' : 'min-h-dvh'}`}>
      <a href="#main" className="skip-link">Skip to content</a>
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
