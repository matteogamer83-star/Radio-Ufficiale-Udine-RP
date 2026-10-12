/* Service worker: permette di installare la radio come app sul telefono.
   Usa sempre la versione più recente dal server; la cache serve solo se sei offline. */
const CACHE = 'radio-ufficiale-v3';
const SHELL = [
  './',
  'index.html',
  'css/base.css',
  'css/login.css',
  'css/device.css',
  'css/app.css',
  'css/admin.css',
  'js/app.js',
  'js/ui.js',
  'js/ui-kit.js',
  'js/util.js',
  'js/settings.js',
  'js/audio.js',
  'js/device.js',
  'js/admin.js',
  'js/waterfall.js',
  'mic-worklet.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/chakra-petch-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/DSEG14Classic-Bold.woff2',
  'fonts/vt323-latin-400-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clic sulla notifica di un SOS: riporta in primo piano la radio
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
