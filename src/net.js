/* Biji — état de la connexion : hors ligne, l'appli continue (tout est dans le navigateur / le dossier),
 * et la synchro Drive repart toute seule au retour du réseau.
 * navigator.onLine ne suffit pas (Wi-Fi sans Internet, portail captif) : on vérifie vraiment, régulièrement,
 * avec une requête HEAD que le service worker laisse passer (il ne répond qu'aux GET).
 */
(function () {
  const B = window.Biji;
  const N = (B.net = { online: navigator.onLine !== false, checkedAt: 0 });
  const EVERY_ONLINE = 60000, EVERY_OFFLINE = 15000, TIMEOUT = 6000;
  let timer = 0, inflight = null;

  function set(on, why) {
    if (on === N.online) return;
    N.online = on;
    document.body.classList.toggle('offline', !on);
    document.dispatchEvent(new CustomEvent('biji:net', { detail: { online: on, why } }));
    if (!on) {
      B.toast('Hors ligne : tout reste enregistré sur cet appareil, la synchro reprendra au retour du réseau', 4500);
    } else {
      B.toast('Connexion retrouvée : synchronisation…', 2500);
      if (B.store && B.store.syncAll) setTimeout(() => B.store.syncAll(), 300);
    }
    schedule();
  }

  /** Vérifie réellement l'accès au réseau (et au site) ; renvoie true/false */
  N.check = function () {
    if (inflight) return inflight;
    inflight = (async () => {
      if (navigator.onLine === false) return false;
      if (!/^https?:$/.test(location.protocol)) return navigator.onLine !== false; // file:// : on se fie au navigateur
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), TIMEOUT);
      try {
        const r = await fetch('build.js?ping=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ac.signal });
        return r.ok || r.status < 500;
      } catch (e) {
        return false;
      } finally { clearTimeout(t); }
    })().then((on) => { N.checkedAt = Date.now(); set(on, 'check'); return on; }).finally(() => { inflight = null; });
    return inflight;
  };

  /** Une requête a échoué faute de réseau (fetch -> TypeError) : on passe hors ligne et on revérifie bientôt */
  N.failed = function (e) {
    if (e && (e.name === 'TypeError' || e.name === 'AbortError' || /Failed to fetch|NetworkError|Load failed|network/i.test(e.message || ''))) {
      N.check();
      return true;
    }
    return false;
  };
  N.isNetErr = (e) => !!e && (e.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|interrompu/i.test(e.message || ''));

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.hidden || !N.online) N.check();
      else schedule();
    }, N.online ? EVERY_ONLINE : EVERY_OFFLINE);
  }
  window.addEventListener('online', () => N.check());
  window.addEventListener('offline', () => set(false, 'event'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - N.checkedAt > 10000) N.check(); });
  N.start = function () {
    document.body.classList.toggle('offline', !N.online);
    N.check();
  };

  /* ---------- Ordre des traits des caractères des notes : préchargé pour le hors ligne ---------- */
  const warmed = new Set();
  N.warmChars = function (text) {
    if (!N.online || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    const todo = [...new Set([...(text || '')].filter((c) => B.isHan && B.isHan(c) && !warmed.has(c)))].slice(0, 400);
    if (!todo.length) return;
    todo.forEach((c) => warmed.add(c));
    let i = 0;
    const next = () => {
      if (i >= todo.length || !N.online) return;
      const c = todo[i++];
      fetch('data/hw/' + c.codePointAt(0).toString(16) + '.js').catch(() => {}).finally(() => setTimeout(next, 20));
    };
    for (let k = 0; k < 4; k++) next();
  };
})();
