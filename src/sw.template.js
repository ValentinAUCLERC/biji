/* Biji — service worker : l'appli démarre et marche hors ligne (PWA).
 * Coquille (HTML, JS, CSS) : réseau d'abord (mises à jour immédiates) mais abandon au bout de quelques secondes
 * (Wi-Fi faible / sans Internet) -> version en cache.
 * Données (dictionnaire, traits, reconnaissance, polices, pdf.js) : cache d'abord (versionnées par leur contenu).
 * Tout ce qu'il faut pour démarrer sans réseau est mis en cache dès l'installation (pas seulement à la 2e visite).
 */
const BUILD = '__BUILD__';
const SHELL = 'biji-shell-' + BUILD;
const DATA = 'biji-data-__DATA__';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'build.js', 'config.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'data/syllables.js'];
// indispensables hors ligne (dictionnaire, reconnaissance locale, polices) : téléchargés à l'installation s'ils manquent
const DATA_FILES = ['data/dict.js', 'data/hlookup.js', 'vendor/hanzilookup.min.js',
  'fonts/instrument-serif-latin-400-normal.woff2', 'fonts/instrument-serif-latin-400-italic.woff2', 'fonts/instrument-serif-latin-ext-400-normal.woff2'];
// utiles mais pas bloquants (import de PDF hors ligne)
const DATA_LATER = ['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];
const NET_TIMEOUT = 4000;

async function fill(cacheName, files) {
  const c = await caches.open(cacheName);
  await Promise.all(files.map(async (f) => {
    if (await c.match(f)) return;
    const r = await fetch(f, { cache: 'no-cache' });
    if (r.ok) await c.put(f, r);
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map((f) => fetch(f, { cache: 'no-cache' }).then((r) => r.ok && c.put(f, r)).catch(() => {})));
    await fill(DATA, DATA_FILES);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('biji-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => { fill(DATA, DATA_LATER).catch(() => {}); }));
});

/** Réseau, mais pas plus de NET_TIMEOUT ms (sinon le cache) ; une réponse réseau tardive met quand même le cache à jour */
function networkFirst(req) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('index.html') : null);
    const t = setTimeout(async () => {
      const hit = await fromCache();
      if (hit && !done) { done = true; resolve(hit); }
    }, NET_TIMEOUT);
    fetch(req).then((r) => {
      clearTimeout(t);
      if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      if (!done) { done = true; resolve(r); }
    }).catch(async () => {
      clearTimeout(t);
      const hit = await fromCache();
      if (!done) { done = true; resolve(hit || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); }
    });
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // seulement les GET du site : les HEAD de vérification de connexion et les appels Google passent tels quels
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = /\/(data|vendor|fonts)\//.test(url.pathname) && !url.pathname.endsWith('syllables.js');
  if (isData) {
    e.respondWith(caches.open(DATA).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  } else {
    e.respondWith(networkFirst(e.request));
  }
});
