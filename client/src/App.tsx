import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBackend } from './net';
import type { Backend, User } from './net/types';
import { ChallengeScreen } from './ui/ChallengeScreen';
import { CreateChallenge } from './ui/CreateChallenge';
import { Home } from './ui/Home';
import { Join } from './ui/Join';
import { LinkDevice } from './ui/LinkDevice';
import { Onboarding } from './ui/Onboarding';
import { Settings } from './ui/Settings';
import { TutorialScreen } from './ui/Tutorial';

// dev tools are split into their own chunks so they never weigh on the player-facing bundle
const Sandbox = lazy(() => import('./dev/Sandbox').then((m) => ({ default: m.Sandbox })));
const MapEditor = lazy(() => import('./dev/MapEditor').then((m) => ({ default: m.MapEditor })));
const Gallery = lazy(() => import('./dev/Gallery').then((m) => ({ default: m.Gallery })));
const VfxDemo = lazy(() => import('./dev/VfxDemo').then((m) => ({ default: m.VfxDemo })));

interface AppCtx {
  backend: Backend;
  user: User;
  setUser: (u: User) => void;
  navigate: (path: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

function extractLinkCode(): string {
  if (location.pathname !== '/link') return '';
  const raw = location.hash.replace(/^#/, '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw) {
    history.replaceState(null, '', '/link');
  }
  return raw.slice(0, 12);
}

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((p: string) => {
    if (p !== location.pathname) history.pushState(null, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate];
}

export function App() {
  const { t } = useTranslation();
  const [path, navigate] = usePath();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string>(() => extractLinkCode());

  useEffect(() => {
    if (path === '/link') {
      const extracted = extractLinkCode();
      if (extracted) setLinkCode(extracted);
    }
  }, [path]);

  useEffect(() => {
    if (path.startsWith('/dev/')) return;
    getBackend()
      .then(async (b) => {
        setBackend(b);
        setUser(await b.me());
      })
      .catch((e) => setFatal(String(e)));
  }, [path]);

  // Listen for session revocation (401 or self sign-out) and keep user metadata fresh across devices.
  useEffect(() => {
    if (!backend) return;
    const unsub = backend.onAuthLost?.(() => {
      setUser(null);
      setAuthNotice(t('onboarding.sessionEnded'));
    });
    const refreshUser = () => {
      if (document.visibilityState === 'visible') {
        void backend
          .refreshMe?.()
          .then((u) => {
            if (u) setUser(u);
          })
          .catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', refreshUser);
    window.addEventListener('focus', refreshUser);
    return () => {
      unsub?.();
      document.removeEventListener('visibilitychange', refreshUser);
      window.removeEventListener('focus', refreshUser);
    };
  }, [backend, t]);

  if (path.startsWith('/dev/')) {
    const tool = path.startsWith('/dev/sandbox') ? (
      <Sandbox />
    ) : path.startsWith('/dev/map-editor') ? (
      <MapEditor />
    ) : path.startsWith('/dev/gallery') ? (
      <Gallery />
    ) : path.startsWith('/dev/vfx') ? (
      <VfxDemo />
    ) : (
      <div className="screen selectable">{t('app.unknownDevTool')}</div>
    );
    return <Suspense fallback={<div className="screen muted">{t('app.loading')}</div>}>{tool}</Suspense>;
  }
  if (fatal) return <div className="screen error">{fatal}</div>;
  if (!backend || user === undefined)
    return (
      <div className="screen bg-art center" style={{ paddingTop: '40vh' }}>
        <h1>{t('app.title')}</h1>
        <div className="muted">{t('app.loading')}</div>
      </div>
    );

  const joinMatch = path.match(/^\/join\/([A-Za-z0-9]+)/);
  if (!user) {
    if (joinMatch) sessionStorage.setItem('siege.pendingJoin', joinMatch[1]);
    return (
      <Onboarding
        backend={backend}
        initialCode={linkCode}
        notice={authNotice}
        onDone={(u) => {
          setAuthNotice(null);
          setLinkCode('');
          setUser(u);
          if (path === '/link') navigate('/');
        }}
      />
    );
  }

  const ctx: AppCtx = { backend, user, setUser, navigate };
  let screen;
  const cMatch = path.match(/^\/c\/([A-Za-z0-9]+)/);
  if (path === '/link' && backend.mode === 'http') screen = <LinkDevice initialCode={linkCode} onClearCode={() => setLinkCode('')} />;
  else if (joinMatch) screen = <Join code={joinMatch[1]} />;
  else if (cMatch) screen = <ChallengeScreen key={cMatch[1]} id={cMatch[1]} />;
  else if (path === '/new') screen = <CreateChallenge />;
  else if (path === '/tutorial') screen = <TutorialScreen />;
  else if (path === '/settings') screen = <Settings />;
  else screen = <Home />;
  return <Ctx.Provider value={ctx}>{screen}</Ctx.Provider>;
}
