import { HttpBackend } from './HttpBackend';
import { LocalBackend } from './LocalBackend';
import type { Backend } from './types';

let backend: Backend | null = null;

/** Uses the server if /api/time answers or if an existing online token is present; otherwise the offline demo backend. */
export async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const forced = new URLSearchParams(location.search).get('backend') ?? localStorage.getItem('siege.backend');
  if (forced !== 'local') {
    const hasToken = Boolean(localStorage.getItem('siege.token'));
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch('/api/time', { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        const h = new HttpBackend();
        await h.init();
        backend = h;
        return h;
      }
    } catch {
      /* fall through */
    }
    // Never silently downgrade a signed-in online user into offline demo mode on a transient startup timeout.
    if (hasToken) {
      const h = new HttpBackend();
      await h.init();
      backend = h;
      return h;
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
