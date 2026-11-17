import { useEffect, useState } from 'react';

// Registers the service worker in production builds only (dev uses Vite's live reload).
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works without it */ });
  });
}

// The browser's install prompt is offered once; we keep it so an "Install app" button can show it.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(Boolean(deferredPrompt)));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

// { canInstall, install }
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt));
  useEffect(() => {
    listeners.add(setCanInstall);
    return () => listeners.delete(setCanInstall);
  }, []);
  const install = async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    notify();
    await prompt.prompt();
  };
  return { canInstall, install };
}
