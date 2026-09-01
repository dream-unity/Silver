const CACHE_NAME = 'silver-shell-v2';
const SHELL = [
  './', './index.html', './bootstrap.js',
  './src/shell.html', './src/styles.css', './src/app.js',
  './shell.html.gz', './styles.css.gz',
  './app.source.1.b64', './app.source.2.b64', './app.source.3.b64', './app.source.4.b64',
  './app.source.5.b64', './app.source.6.b64', './app.source.7.b64', './app.source.8.b64',
  './db.js', './archive.js', './manifest.webmanifest', './icons/silver-mark.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isRuntimeCode = event.request.mode === 'navigate'
    || url.pathname.endsWith('/bootstrap.js')
    || url.pathname.includes('/src/');
  if (isRuntimeCode) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client);
      return existing ? existing.focus() : self.clients.openWindow('./?new=1');
    })
  );
});
