import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import './index.css';

void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    // no StrictMode: double-mounting a WebGL app causes flaky canvases
    <App />,
  );
});
