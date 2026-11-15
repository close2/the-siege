import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';

export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
};

export const LANG_STORAGE_KEY = 'siege.lang';

export function isSupportedLocale(v: string | null | undefined): v is Locale {
  return v === 'en' || v === 'de' || v === 'fr';
}

export function matchBrowserLocale(languages: readonly string[]): Locale | null {
  for (const raw of languages) {
    if (!raw) continue;
    const base = raw.split(/[-_]/)[0]?.toLowerCase();
    if (isSupportedLocale(base)) return base;
  }
  return null;
}

/**
 * Resolve initial locale:
 * 1. Saved user preference in localStorage (`siege.lang`)
 * 2. Browser preferred languages (`navigator.languages` / `navigator.language`)
 * 3. Fallback `'en'`
 */
export function detectInitialLocale(opts?: { saved?: string | null; browserLanguages?: readonly string[] }): Locale {
  let saved = opts?.saved;
  if (saved === undefined) {
    try {
      saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_STORAGE_KEY) : null;
    } catch {
      saved = null;
    }
  }
  if (isSupportedLocale(saved)) return saved;

  let langs = opts?.browserLanguages;
  if (langs === undefined) {
    if (typeof navigator !== 'undefined') {
      langs = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
    } else {
      langs = [];
    }
  }
  return matchBrowserLocale(langs) ?? 'en';
}

const loadedBundles = new Set<Locale>(['en']);

async function ensureLocaleBundle(locale: Locale): Promise<void> {
  if (loadedBundles.has(locale) && i18n.hasResourceBundle(locale, 'translation')) return;
  let data: Record<string, unknown>;
  if (locale === 'de') {
    data = (await import('../locales/de.json')).default;
  } else if (locale === 'fr') {
    data = (await import('../locales/fr.json')).default;
  } else {
    data = en;
  }
  i18n.addResourceBundle(locale, 'translation', data, true, true);
  loadedBundles.add(locale);
}

function syncDocumentAndSw(lng: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
    document.title = i18n.t('app.title');
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.controller?.postMessage({ type: 'SIEGE_SET_LANG', lang: lng });
    } catch {
      /* ignore */
    }
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      const req = indexedDB.open('siege-i18n', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('prefs')) req.result.createObjectStore('prefs');
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('prefs', 'readwrite');
          tx.objectStore('prefs').put(lng, 'lang');
          tx.oncomplete = () => req.result.close();
        } catch {
          req.result.close();
        }
      };
    } catch {
      /* ignore */
    }
  }
}

// Initialize synchronously with English fallback so `i18n.t()` works immediately in tests and modules.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

i18n.on('languageChanged', (lng) => {
  if (isSupportedLocale(lng)) syncDocumentAndSw(lng);
});

let initPromise: Promise<Locale> | null = null;

/** Detect user locale, lazy-load its bundle if needed, and activate it before first render. */
export function initI18n(): Promise<Locale> {
  initPromise ??= (async () => {
    const initial = detectInitialLocale();
    await ensureLocaleBundle(initial);
    if (i18n.language !== initial) {
      await i18n.changeLanguage(initial);
    } else {
      syncDocumentAndSw(initial);
    }
    return initial;
  })();
  return initPromise;
}

export function getLanguage(): Locale {
  return isSupportedLocale(i18n.language) ? i18n.language : 'en';
}

export async function setLanguage(locale: Locale, persist = true): Promise<void> {
  if (persist) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }
  await ensureLocaleBundle(locale);
  await i18n.changeLanguage(locale);
}

export { i18n };
export default i18n;
