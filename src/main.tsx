import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type BoundaryState = { hasError: boolean };

// Prevent an unexpected component error from leaving the user with only the
// page background. The fallback uses inline styles so it remains visible even
// when the stylesheet or a lazy asset fails to load.
class MovyzaAppBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Movyza] App render failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const isArabic = (document.documentElement.lang || 'ar').toLowerCase().startsWith('ar');

    return (
      <main
        dir={isArabic ? 'rtl' : 'ltr'}
        style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px',
          background: '#050507', color: '#f8fafc', fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <section style={{ maxWidth: '420px' }}>
          <div style={{
            width: '64px', height: '64px', margin: '0 auto 20px', borderRadius: '18px',
            display: 'grid', placeItems: 'center', color: '#111', fontWeight: 900,
            fontSize: '34px', background: 'linear-gradient(135deg,#ffe6a0,#f2b84b,#b87920)',
          }}>M</div>
          <h1 style={{ fontSize: '24px', margin: '0 0 12px' }}>
            {isArabic ? 'تعذّر تحميل موفيزا' : 'Movyza could not load'}
          </h1>
          <p style={{ color: '#a1a1aa', lineHeight: 1.8, margin: '0 0 24px' }}>
            {isArabic
              ? 'حدث خطأ غير متوقع أثناء تشغيل الواجهة. أعد تحميل الصفحة للمحاولة مجددًا.'
              : 'An unexpected error occurred while rendering the app. Reload the page to try again.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0, borderRadius: '12px', padding: '12px 22px', fontWeight: 800,
              cursor: 'pointer', color: '#111', background: '#f2b84b',
            }}
          >
            {isArabic ? 'إعادة تحميل الصفحة' : 'Reload page'}
          </button>
        </section>
      </main>
    );
  }
}

// Remove stale PWA/service-worker caches left by older Movyz builds.
// The current app does not rely on offline caches, so keeping an old bundle
// must never override the freshly deployed Cloudflare assets.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  }).catch((error) => console.warn('[Movyza] Could not unregister an old service worker:', error));
}

if ('caches' in window) {
  void caches.keys().then((keys) => {
    keys.forEach((key) => void caches.delete(key));
  }).catch((error) => console.warn('[Movyza] Could not clear old caches:', error));
}

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;background:#050507;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><strong style="color:#f2b84b;font-size:32px">M</strong><p>تعذر العثور على مساحة تشغيل موفيزا. أعد تحميل الصفحة.</p><button onclick="location.reload()" style="padding:12px 20px;border:0;border-radius:12px;background:#f2b84b;font-weight:700">إعادة التحميل</button></div></main>';
  throw new Error('Movyza root element #root is missing');
}

createRoot(root).render(
  <StrictMode>
    <MovyzaAppBoundary>
      <App />
    </MovyzaAppBoundary>
  </StrictMode>,
);
