// Offline-Cache nur für die eigene Anwendungsoberfläche – niemals für API-Antworten oder Reddit-Inhalte.
const CACHE = 'reddit-investigator-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './css/tokens.css',
  './css/app.css',
  './js/theme-boot.js',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/dom.js',
  './js/export.js',
  './js/filters.js',
  './js/net.js',
  './js/posts.js',
  './js/search-engine.js',
  './js/storage.js',
  './js/text.js',
  './js/username.js',
  './js/adapters/arctic-shift.js',
  './js/adapters/reddit-local.js',
  './js/adapters/external-search.js',
  './js/ui/card.js',
  './js/ui/charts.js',
  './js/ui/detail.js',
  './js/ui/explorer.js',
  './js/ui/feedback.js',
  './js/ui/findings.js',
  './js/ui/history.js',
  './js/ui/home.js',
  './js/ui/overview.js',
  './js/ui/posts-view.js',
  './js/ui/settings.js',
  './js/ui/statusbar.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('reddit-investigator-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Netzwerk zuerst, damit Aktualisierungen des Moduls sofort greifen; Cache als Offline-Rückfall.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./index.html')))
  );
});
