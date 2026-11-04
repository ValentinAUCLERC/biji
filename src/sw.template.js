/* Biji — service worker : l'appli marche hors ligne une fois visitée.
 * Coquille (HTML, JS, CSS, polices) : réseau d'abord, cache en secours (mises à jour immédiates).
 * Données (dictionnaire, traits, reconnaissance) : cache d'abord (versionnées par build).
 */
const BUILD = '__BUILD__';
const SHELL = 'biji-shell-' + BUILD;
const DATA = 'biji-data-__DATA__';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'build.js', 'config.js', 'style.css', 'data/syllables.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('biji-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = /\/(data|vendor|fonts)\//.test(url.pathname) && !url.pathname.endsWith('syllables.js');
  if (isData) {
    e.respondWith(caches.open(DATA).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  } else {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) caches.open(SHELL).then((c) => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
