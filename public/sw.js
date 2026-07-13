const CACHE_NAME = 'comandas-qr-v2';
const ASSETS = [
  '/',
  '/login',
  '/styles.css',
  '/dashboard.js',
  '/client.js',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))).then(() =>
        self.clients.claim(),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document';

  event.respondWith(
    (async () => {
      if (isDocument) {
        try {
          const response = await fetch(event.request);
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        } catch {
          const cachedDocument = await caches.match(event.request);
          const cachedLogin = await caches.match('/login');
          return cachedDocument || cachedLogin || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      }

      try {
        const response = await fetch(event.request);
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }

        const cachedLogin = await caches.match('/login');
        return cachedLogin || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })(),
  );
});
