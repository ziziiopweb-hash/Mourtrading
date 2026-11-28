import { createRoot } from 'react-dom/client';
import App, { ErrorBoundary } from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    (window as unknown as { deferredPrompt?: Event }).deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('mour-pwa-prompt-ready'));
  });
}

const rootEl = document.getElementById('root');

if (rootEl) {
  try {
    createRoot(rootEl).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const box = document.createElement('div');
    box.style.cssText =
      'min-height:100vh;background:#070A0F;color:#F1F5F9;display:flex;align-items:center;justify-content:center;padding:24px;font-family:sans-serif;';
    const card = document.createElement('div');
    card.style.cssText =
      'max-width:560px;width:100%;background:#0D131F;border:1px solid rgba(239,68,68,0.5);border-radius:16px;padding:24px;';
    const h2 = document.createElement('h2');
    h2.style.cssText = 'color:#EF4444;margin:0 0 12px 0;font-size:18px;';
    h2.textContent = 'MourTrading Initialization Error';
    const p = document.createElement('p');
    p.style.cssText = 'color:#E2E8F0;margin:0;font-size:13px;word-break:break-word;';
    p.textContent = msg;
    card.appendChild(h2);
    card.appendChild(p);
    box.appendChild(card);
    rootEl.replaceChildren(box);
  }
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration skipped if blocked in restricted iframe context
    });
  });
}
