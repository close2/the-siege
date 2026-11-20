import { HttpBackend } from './HttpBackend';
import { LocalBackend } from './LocalBackend';
import type { Backend } from './types';

let backend: Backend | null = null;
const WAS_ONLINE = 'siege.wasOnline';

/**
 * Selects HttpBackend whenever the server is reachable, an online token exists, or this origin
 * has previously talked to the server. Falls back to LocalBackend only on explicit `?backend=local`
 * or on a static/serverless host where `/api/time` has never answered.
 */
export async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const forced = new URLSearchParams(location.search).get('backend') ?? localStorage.getItem('siege.backend');
  if (forced !== 'local') {
    const hasToken = Boolean(localStorage.getItem('siege.token'));
    const wasOnline = localStorage.getItem(WAS_ONLINE) === '1';
    if (forced === 'http' || hasToken || wasOnline) {
      if (hasToken && !wasOnline) {
        try {
          localStorage.setItem(WAS_ONLINE, '1');
        } catch {
          /* ignore */
        }
      }
      const h = new HttpBackend();
      await h.init();
      backend = h;
      return h;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('/api/time', { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        try {
          localStorage.setItem(WAS_ONLINE, '1');
        } catch {
          /* ignore */
        }
        const h = new HttpBackend();
        await h.init();
        backend = h;
        return h;
      }
    } catch {
      /* fall through */
    }
  }
  const l = new LocalBackend();
  await l.init();
  backend = l;
  return backend;
}

export function currentBackend(): Backend {
  if (!backend) throw new Error('backend not initialised');
  return backend;
}
