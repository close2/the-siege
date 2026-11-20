import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import './index.css';

// Reload once when an updated PWA service worker takes control, and check for updates on resume.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update())
        .catch(() => undefined);
    }
  });
}

void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    // no StrictMode: double-mounting a WebGL app causes flaky canvases
    <App />,
  );
});
