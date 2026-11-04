/* Biji — synchro Google Drive (téléphone, tablette, autres PC), sans serveur.
 * Connexion Google (Google Identity Services, jeton d'accès 1 h) + API REST Drive v3 appelée depuis le navigateur.
 * Permission « drive.file » : Biji ne voit que les fichiers qu'il a créés lui-même.
 * Dans Drive : dossier « Biji » (un fichier <id>.json par cours, updatedAt dans appProperties.u) + sous-dossier « audio ».
 * Jeton expiré : rien n'est perdu (tout reste dans le navigateur) ; un clic sur « Reconnecter » relance la synchro.
 */
(function () {
  const B = window.Biji;
  const S = B.store;
  const CFG = window.BIJI_CONFIG || {};
  const API = (CFG.driveApi || 'https://www.googleapis.com').replace(/\/$/, '');
  const GIS = CFG.gisSrc || 'https://accounts.google.com/gsi/client';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER = 'application/vnd.google-apps.folder';
  const TOKEN_KEY = 'biji.gtoken';

  const G = (B.gdrive = { state: 'off' /* off | on | expired */, email: '', name: '', folderId: '', audioId: '', progress: '' });
  G.available = () => !!CFG.googleClientId && /^https?:$/.test(location.protocol);

  /* ---------- jeton ---------- */
  let token = null; // { t, exp }
  try { token = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { token = null; }
  const tokenOk = () => !!(token && token.exp > Date.now() + 30000);
  let client = null, waiting = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return B.loadScript(GIS);
  }
  function getClient() {
    if (client) return client;
    client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.googleClientId,
      scope: SCOPE,
      callback: (r) => {
        const w = waiting;
        waiting = null;
        if (!w) return;
        if (r && r.access_token && google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
          token = { t: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 };
          localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
          w.res(token.t);
        } else w.rej(new Error(r && r.error ? 'Google : ' + r.error : 'Accès à Google Drive refusé'));
      },
      error_callback: (e) => {
        const w = waiting;
        waiting = null;
        if (w) w.rej(new Error(e && e.type === 'popup_failed_to_open' ? 'Fenêtre Google bloquée par le navigateur' : 'Connexion Google annulée'));
      },
    });
    return client;
  }
  /** À appeler directement dans un clic (la fenêtre Google doit être ouverte par un geste de l'utilisateur) */
  function requestToken(pick) {
    return new Promise((res, rej) => {
      const go = () => {
        if (waiting) waiting.rej(new Error('Connexion Google annulée'));
        waiting = { res, rej };
        getClient().requestAccessToken(pick || !G.email ? { prompt: 'select_account' } : { prompt: '', login_hint: G.email });
      };
      if (window.google && google.accounts && google.accounts.oauth2) go();
      else loadGis().then(go, () => rej(new Error('Impossible de charger la connexion Google (hors ligne ?)')));
    });
  }

  /* ---------- API Drive ---------- */
  async function api(path, opts = {}) {
    if (!tokenOk()) { expire(); throw new Error('Connexion Google expirée'); }
    const r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token.t }, opts.headers || {}) }));
    if (r.status === 401) { expire(); throw new Error('Connexion Google expirée'); }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* pas du JSON */ }
      if (r.status === 403 && /has not been used|is disabled/i.test(msg)) msg = 'API Google Drive non activée dans le projet Google Cloud';
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return r;
  }
  const json = async (path, opts) => (await api(path, opts)).json();
  const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function listAll(q, fields = 'id,name,appProperties,size') {
    const out = [];
    let page = '';
    do {
      const r = await json('/drive/v3/files?' + qs(Object.assign({ q, fields: 'nextPageToken,files(' + fields + ')', pageSize: 1000, spaces: 'drive', orderBy: 'createdTime' }, page ? { pageToken: page } : {})));
      out.push(...(r.files || []));
      page = r.nextPageToken || '';
    } while (page);
    return out;
  }
  function multipart(meta, content, type) {
    const b = 'biji' + B.uid();
    return {
      body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, content, `\r\n--${b}--`]),
      headers: { 'Content-Type': 'multipart/related; boundary=' + b },
    };
  }
  async function folder(name, parent) {
    const q = `name='${esc(name)}' and mimeType='${FOLDER}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
    const found = await listAll(q, 'id,name');
    if (found.length) return found[0].id;
    const r = await json('/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ name, mimeType: FOLDER }, parent ? { parents: [parent] } : {})),
    });
    return r.id;
  }
  async function stillThere(id) {
    if (!id) return false;
    try { const r = await json('/drive/v3/files/' + id + '?fields=id,trashed'); return !r.trashed; } catch (e) { if (e.status === 404) return false; throw e; }
  }
  async function ensureFolders() {
    if (!(await stillThere(G.folderId))) { G.folderId = await folder('Biji'); G.audioId = ''; }
    if (!(await stillThere(G.audioId))) G.audioId = await folder('audio', G.folderId);
    await save();
  }
  const save = () => S.kvSet('gdrive', G.state === 'off' ? null : { email: G.email, name: G.name, folderId: G.folderId, audioId: G.audioId });

  /* ---------- destination de synchro ---------- */
  const ids = new Map(); // nom de fichier -> id Drive
  const audioIds = new Map();
  const queues = new Map();
  const be = {
    id: 'gdrive',
    label: () => 'Google Drive',
    ready: () => G.state === 'on' && (tokenOk() || (expire(), false)),
    async list() {
      await ensureFolders();
      const out = new Map();
      ids.clear();
      for (const f of await listAll(`'${G.folderId}' in parents and trashed=false and mimeType!='${FOLDER}'`)) {
        const m = /^(c\w+)\.json$/.exec(f.name);
        if (!m || ids.has(f.name)) continue;
        ids.set(f.name, f.id);
        out.set(m[1], { u: +((f.appProperties || {}).u) || 0, fid: f.id });
      }
      return out;
    },
    async read(r) {
      return (await api('/drive/v3/files/' + r.fid + '?alt=media')).json();
    },
    write(l) {
      if (!be.ready()) return Promise.resolve(false);
      const name = l.id + '.json';
      const prev = queues.get(name) || Promise.resolve();
      const data = JSON.stringify(l);
      const u = String(l.updatedAt || 0);
      const p = prev.catch(() => {}).then(async () => {
        let fid = ids.get(name);
        if (!fid) {
          const f = await listAll(`name='${name}' and '${G.folderId}' in parents and trashed=false`, 'id');
          if (f.length) ids.set(name, (fid = f[0].id));
        }
        if (fid) {
          const m = multipart({ appProperties: { u } }, data, 'application/json');
          await api('/upload/drive/v3/files/' + fid + '?uploadType=multipart&fields=id', { method: 'PATCH', body: m.body, headers: m.headers });
        } else {
          const m = multipart({ name, parents: [G.folderId], mimeType: 'application/json', appProperties: { u } }, data, 'application/json');
          const r = await (await api('/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: m.body, headers: m.headers })).json();
          ids.set(name, r.id);
        }
        return true;
      });
      queues.set(name, p);
      return p;
    },
    async audioNames() {
      audioIds.clear();
      for (const f of await listAll(`'${G.audioId}' in parents and trashed=false`, 'id,name')) audioIds.set(f.name, f.id);
      return new Set(audioIds.keys());
    },
    /** Envoi « reprenable » (fichiers de plusieurs dizaines de Mo), avec progression */
    async audioPut(rec, blob) {
      if (!be.ready()) return false;
      if (!G.audioId) await ensureFolders();
      if (audioIds.has(rec.file)) return true;
      const init = await api('/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'audio/webm', 'X-Upload-Content-Length': String(blob.size) },
        body: JSON.stringify({ name: rec.file, parents: [G.audioId], mimeType: blob.type || 'audio/webm', appProperties: { rec: rec.id } }),
      });
      const url = init.headers.get('Location');
      if (!url) throw new Error('Envoi audio : réponse Google inattendue');
      const r = await new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open('PUT', url);
        x.setRequestHeader('Content-Type', blob.type || 'audio/webm');
        x.upload.onprogress = (e) => { if (e.lengthComputable) progress('Envoi de l’audio vers Drive : ' + Math.round((e.loaded / e.total) * 100) + ' %'); };
        x.onload = () => (x.status >= 200 && x.status < 300 ? res(JSON.parse(x.responseText || '{}')) : rej(new Error('Envoi audio : HTTP ' + x.status)));
        x.onerror = () => rej(new Error('Envoi audio interrompu (connexion ?)'));
        x.send(blob);
      }).finally(() => progress(''));
      if (r.id) audioIds.set(rec.file, r.id);
      S.status('Audio envoyé sur Google Drive');
      return true;
    },
    async audioGet(rec) {
      if (!audioIds.has(rec.file)) await be.audioNames();
      const id = audioIds.get(rec.file);
      if (!id) return null;
      progress('Téléchargement de l’audio depuis Drive…');
      try { return await (await api('/drive/v3/files/' + id + '?alt=media')).blob(); } finally { progress(''); }
    },
    async audioDel(rec) {
      if (!audioIds.has(rec.file)) await be.audioNames();
      const id = audioIds.get(rec.file);
      if (!id) return;
      // corbeille plutôt que suppression définitive : récupérable 30 jours dans Drive
      await api('/drive/v3/files/' + id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      audioIds.delete(rec.file);
    },
  };
  S.register(be);

  function progress(t) { G.progress = t; if (t) S.status(t); }
  function expire() {
    if (G.state !== 'on') return;
    G.state = 'expired';
    ui();
  }
  function ui() { document.dispatchEvent(new CustomEvent('biji:cloud')); }

  /* ---------- actions ---------- */
  G.init = async function () {
    if (!G.available()) return;
    const k = await S.kvGet('gdrive').catch(() => null);
    if (!k) return;
    Object.assign(G, k);
    G.state = tokenOk() ? 'on' : 'expired';
    loadGis().catch(() => {}); // prêt pour un « Reconnecter » instantané
    if (G.state === 'expired') armAutoReconnect();
  };
  be.init = G.init;

  /** Premier appareil ou nouvel appareil : choisir le compte Google */
  G.connect = async function () {
    if (!G.available()) return B.toast('Synchro Google non configurée sur cette version du site', 5000);
    try {
      await requestToken(true);
      const me = await json('/drive/v3/about?fields=user(emailAddress,displayName)');
      G.email = (me.user && me.user.emailAddress) || '';
      G.name = (me.user && me.user.displayName) || '';
      G.state = 'on';
      await ensureFolders();
      ui();
      const r = await S.sync(be);
      ui();
      if (r && !r.error) B.toast('Google Drive connecté : ' + (r.pulled ? r.pulled + ' cours reçu(s), ' : '') + 'synchro active', 4000);
      return true;
    } catch (e) {
      B.toast(e.message, 5000);
      return false;
    }
  };
  /** Jeton expiré (1 h) : nouveau jeton sans re-choisir le compte */
  G.reconnect = async function () {
    try {
      await requestToken(false);
      G.state = 'on';
      ui();
      await S.syncAll();
      ui();
      return true;
    } catch (e) {
      B.toast(e.message, 5000);
      return false;
    }
  };
  G.disconnect = async function () {
    if (token && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(token.t, () => {}); } catch (e) { /* déjà invalide */ } }
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    G.state = 'off';
    G.email = G.name = G.folderId = G.audioId = '';
    await save();
    ui();
  };
  G.syncNow = async function () {
    if (G.state === 'expired') return G.reconnect();
    await S.syncAll();
    ui();
  };

  /** À l'ouverture, le premier clic sur un bouton ou un lien relance la connexion (un clic est obligatoire côté Google) */
  function armAutoReconnect() {
    const h = (e) => {
      if (G.state !== 'expired') return document.removeEventListener('click', h, true);
      if (!e.target.closest || !e.target.closest('button, a') || e.target.closest('[data-cloud]')) return;
      document.removeEventListener('click', h, true);
      G.reconnect();
    };
    document.addEventListener('click', h, true);
  }
  // jeton qui expire pendant l'utilisation : on le signale
  setInterval(() => { if (G.state === 'on' && !tokenOk()) expire(); }, 30000);
})();
