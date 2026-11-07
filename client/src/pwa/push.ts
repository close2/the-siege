// Web Push subscription helpers (VAPID). Works when the PWA's service worker is active.
import type { Backend } from '../net/types';

function b64ToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(backend: Backend): Promise<void> {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? 'On iPhone, first add the app to your home screen (Share → Add to Home Screen), then enable notifications there.' : 'Notifications are not supported in this browser.');
  const key = await backend.pushKey();
  if (!key) throw new Error('Notifications need the server.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) as BufferSource }));
  await backend.pushSubscribe(sub.toJSON());
}

export async function disablePush(backend: Backend): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
