import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Remove stale PWA/service-worker caches left by older Movyz builds.
// The current app does not rely on offline caches, so keeping an old bundle
// must never override the freshly deployed Cloudflare assets.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}

if ('caches' in window) {
  void caches.keys().then((keys) => {
    keys.forEach((key) => void caches.delete(key));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
