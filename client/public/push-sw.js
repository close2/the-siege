// Web Push event handlers imported by the generated Workbox service worker (/sw.js).
let cachedLang = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SIEGE_SET_LANG' && typeof event.data.lang === 'string') {
    cachedLang = event.data.lang;
  }
});

function pickSupportedLang(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const base = raw.split(/[-_]/)[0].toLowerCase();
  return base === 'en' || base === 'de' || base === 'fr' ? base : null;
}

function readStoredLang() {
  if (cachedLang) return Promise.resolve(cachedLang);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('siege-i18n', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('prefs')) req.result.createObjectStore('prefs');
      };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('prefs', 'readonly');
          const getReq = tx.objectStore('prefs').get('lang');
          getReq.onsuccess = () => {
            const found = pickSupportedLang(getReq.result);
            if (found) cachedLang = found;
            req.result.close();
            resolve(found);
          };
          getReq.onerror = () => {
            req.result.close();
            resolve(null);
          };
        } catch {
          req.result.close();
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const PUSH_STRINGS = {
  en: {
    appTitle: 'The Siege',
    fallbackBody: 'Check in on your sector before Dawn.',
    fallbackPlain: 'Your valley needs you.',
    dawnTitle: (day, title) => `☀ Dawn ${day} — ${title}`,
    dawnBody: 'The battle has been fought. See how your sector held!',
    remindTitle: (title) => `${title} — your sector needs you`,
    remindBody: (day) => `Report day ${day} before Dawn to earn gold and send your hero.`,
  },
  de: {
    appTitle: 'Die Belagerung',
    fallbackBody: 'Sieh vor dem Morgengrauen nach deinem Sektor.',
    fallbackPlain: 'Dein Tal braucht dich.',
    dawnTitle: (day, title) => `☀ Morgengrauen ${day} — ${title}`,
    dawnBody: 'Die Schlacht wurde geschlagen. Sieh nach, wie dein Sektor standgehalten hat!',
    remindTitle: (title) => `${title} — dein Sektor braucht dich`,
    remindBody: (day) => `Melde Tag ${day} vor dem Morgengrauen, um Gold zu verdienen und deinen Helden zu schicken.`,
  },
  fr: {
    appTitle: 'Le Siège',
    fallbackBody: 'Faites votre bilan avant l’Aube.',
    fallbackPlain: 'Votre vallée a besoin de vous.',
    dawnTitle: (day, title) => `☀ Aube ${day} — ${title}`,
    dawnBody: 'La bataille a eu lieu. Voyez comment votre secteur a tenu !',
    remindTitle: (title) => `${title} — votre secteur a besoin de vous`,
    remindBody: (day) => `Faites le bilan du jour ${day} avant l’Aube pour gagner de l’or et envoyer votre héros.`,
  },
};

self.addEventListener('push', (event) => {
  event.waitUntil(
    readStoredLang().then((storedLang) => {
      const browserLang =
        (self.navigator && Array.isArray(self.navigator.languages) && self.navigator.languages.map(pickSupportedLang).find(Boolean)) ||
        pickSupportedLang(self.navigator && self.navigator.language);
      const lang = storedLang || browserLang || 'en';
      const tr = PUSH_STRINGS[lang] || PUSH_STRINGS.en;

      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = { title: tr.appTitle, body: event.data ? event.data.text() : tr.fallbackPlain };
      }

      let title = data.title || tr.appTitle;
      let body = data.body || tr.fallbackBody;
      if (data.kind === 'dawn' && data.day && data.challengeTitle) {
        title = tr.dawnTitle(data.day, data.challengeTitle);
        body = tr.dawnBody;
      } else if (data.kind === 'remind' && data.day && data.challengeTitle) {
        title = tr.remindTitle(data.challengeTitle);
        body = tr.remindBody(data.day);
      }

      return self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
