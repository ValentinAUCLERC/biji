/* Biji — stockage : IndexedDB (toujours) + destinations synchronisées (« backends ») :
 *   - dossier sur le disque (File System Access, Chrome/Edge PC)
 *   - Google Drive (gdrive.js) pour téléphone, tablette, autres PC
 * Un cours = un fichier <id>.json ; les enregistrements audio vont dans audio/<fichier>.webm,
 * les images et pages de PDF annotables dans images/<fichier>.webp|jpg.
 * Le plus récent (updatedAt) gagne à la fusion. Suppression = « pierre tombale » {id, deleted:true}.
 */
(function () {
  const B = window.Biji;
  const S = (B.store = { lessons: new Map(), dir: null, dirState: 'none' /* none | granted | prompt */, backends: [] });

  let dbp = null;
  function db() {
    return (dbp = dbp || new Promise((res, rej) => {
      const q = indexedDB.open('biji', 3);
      q.onupgradeneeded = () => {
        const d = q.result;
        if (!d.objectStoreNames.contains('lessons')) d.createObjectStore('lessons', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
        if (!d.objectStoreNames.contains('recchunks')) d.createObjectStore('recchunks', { autoIncrement: true });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    }));
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  }
  S.tx = tx;
  S.kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  S.kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
  const idbAudio = (id) => tx('audio', 'readonly', (s) => s.get(id));
  const idbImage = (file) => tx('images', 'readonly', (s) => s.get(file));
  /** Fichiers image utilisés par un cours (blocs « pic » du document) */
  const picsOf = (l) => {
    const out = [];
    const walk = (n) => { if (!n) return; if (n.type === 'pic' && n.attrs && n.attrs.file) out.push(n.attrs.file); (n.content || []).forEach(walk); };
    walk(l.doc);
    return out;
  };
  S.picsOf = picsOf;

  /** Destination synchronisée : { id, label(), ready(), list(), read(ref), write(lesson), audioNames(), audioPut(rec, blob), audioGet(rec), audioDel(rec) } */
  S.register = (be) => { S.backends.push(be); };
  const ready = () => S.backends.filter((b) => b.ready());

  S.init = async function () {
    const all = await tx('lessons', 'readonly', (s) => s.getAll());
    all.forEach((l) => S.lessons.set(l.id, l));
    const h = await S.kvGet('dir').catch(() => null);
    if (h) {
      S.dir = h;
      S.dirState = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
    }
    for (const be of S.backends) if (be.init) await be.init().catch((e) => console.warn(be.id, e));
    await S.syncAll();
  };

  S.list = () => [...S.lessons.values()].filter((l) => !l.deleted)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  S.get = (id) => { const l = S.lessons.get(id); return l && !l.deleted ? l : null; };

  /* ---------- écriture ---------- */
  const pending = new Map();
  const flushSoon = B.debounce(() => S.flush(), 700);
  /** Marque un cours modifié ; écrit après 700 ms d'inactivité */
  S.touch = function (lesson) {
    lesson.updatedAt = Date.now();
    S.lessons.set(lesson.id, lesson);
    pending.set(lesson.id, lesson);
    S.status('Modifications…');
    flushSoon();
  };
  S.flush = async function () {
    if (B.editor && B.editor.syncDoc) B.editor.syncDoc();
    const items = [...pending.values()];
    pending.clear();
    if (!items.length) return;
    await tx('lessons', 'readwrite', (s) => items.forEach((l) => s.put(l)));
    const bes = ready();
    const done = [];
    let waiting = false;
    for (const be of bes) {
      if (be.id !== 'dir' && !B.net.online) { waiting = true; continue; } // partira à la prochaine synchro
      let ok = true;
      for (const l of items) ok = (await be.write(l).catch((e) => { console.warn(be.id, e); if (be.id !== 'dir') B.net.failed(e); return false; })) && ok;
      if (ok) done.push(be.label());
      else waiting = true;
    }
    const where = done.length ? 'Enregistré · ' + done.join(' + ') : 'Enregistré dans le navigateur';
    S.status(waiting ? where + (B.net.online ? ' (synchro en attente)' : ' · hors ligne, synchro au retour') : where);
  };
  window.addEventListener('pagehide', () => S.flush());
  document.addEventListener('visibilitychange', () => document.hidden && S.flush());

  S.create = function (fields) {
    const l = Object.assign({ id: 'c' + B.uid(), v: 2, title: '', date: B.today(), createdAt: Date.now(),
      doc: null, inks: {}, grids: {}, vocab: [], recordings: [] }, fields);
    S.touch(l);
    return l;
  };
  S.remove = function (id) {
    const l = S.lessons.get(id);
    if (!l) return;
    S.touch({ id, deleted: true, title: l.title, createdAt: l.createdAt });
  };

  /* ---------- audio ---------- */
  /** Sauve dans le navigateur puis vers chaque destination ; renvoie true si le dossier local l'a reçu */
  S.saveAudio = async function (rec, blob) {
    await tx('audio', 'readwrite', (s) => s.put(blob, rec.id));
    let onDir = false;
    for (const be of ready()) {
      if (be.id !== 'dir' && !B.net.online) continue; // envoyé à la prochaine synchro
      const p = be.audioPut(rec, blob).catch((e) => { console.warn(be.id, e); return false; });
      if (be.id === 'dir') onDir = await p; // l'envoi vers Drive continue en arrière-plan
    }
    return onDir;
  };
  S.getAudio = async function (rec) {
    const b = await idbAudio(rec.id);
    if (b) return b;
    for (const be of ready()) {
      const f = await be.audioGet(rec).catch(() => null);
      if (f) {
        tx('audio', 'readwrite', (s) => s.put(f, rec.id)).catch(() => {});
        return f;
      }
    }
    return null;
  };
  S.deleteAudio = async function (rec) {
    await tx('audio', 'readwrite', (s) => s.delete(rec.id));
    for (const be of ready()) await be.audioDel(rec).catch(() => {});
  };
  /* ---------- images (photos, captures, pages de PDF) ---------- */
  S.saveImage = async function (file, blob) {
    await tx('images', 'readwrite', (s) => s.put(blob, file));
    for (const be of ready()) {
      if (!be.imgPut) continue;
      if (be.id !== 'dir' && !B.net.online) continue; // envoyée à la prochaine synchro
      const p = be.imgPut(file, blob).catch((e) => { console.warn(be.id, e); return false; });
      if (be.id === 'dir') await p;
    }
  };
  const fetching = new Map();
  S.getImage = function (file) {
    if (!fetching.has(file)) {
      fetching.set(file, (async () => {
        const b = await idbImage(file);
        if (b) return b;
        for (const be of ready()) {
          if (!be.imgGet) continue;
          const f = await be.imgGet(file).catch(() => null);
          if (f) { await tx('images', 'readwrite', (s) => s.put(f, file)).catch(() => {}); return f; }
        }
        return null;
      })().finally(() => setTimeout(() => fetching.delete(file), 0)));
    }
    return fetching.get(file);
  };

  /** Morceaux d'un enregistrement en cours (récupération après plantage) */
  S.addChunk = (recId, lessonId, startedAt, blob) => tx('recchunks', 'readwrite', (s) => s.add({ recId, lessonId, startedAt, blob, at: Date.now() }));
  S.takeChunks = async function (recId) {
    const all = await tx('recchunks', 'readonly', (s) => s.getAll());
    const keys = await tx('recchunks', 'readonly', (s) => s.getAllKeys());
    const mine = [], mineKeys = [];
    all.forEach((c, i) => { if (!recId || c.recId === recId) { mine.push(c); mineKeys.push(keys[i]); } });
    return { chunks: mine, drop: () => tx('recchunks', 'readwrite', (s) => mineKeys.forEach((k) => s.delete(k))) };
  };

  /* ---------- synchronisation générique ---------- */
  const locks = new Map();
  /** Fusion destination <-> navigateur : le plus récent gagne, puis on réécrit là où c'est plus ancien */
  S.sync = function (be) {
    const prev = locks.get(be.id) || Promise.resolve();
    const p = prev.then(() => syncOne(be)).catch((e) => {
      console.warn('synchro', be.id, e);
      if (be.id !== 'dir' && B.net.failed(e)) S.status('Hors ligne · enregistré sur cet appareil, synchro au retour du réseau');
      else S.status('Synchro ' + be.label() + ' impossible : ' + e.message, true);
      return { pulled: 0, pushed: 0, error: e };
    });
    locks.set(be.id, p);
    return p;
  };
  async function syncOne(be) {
    if (!be.ready()) return { pulled: 0, pushed: 0 };
    // hors ligne : le dossier local marche toujours ; Drive attend le retour du réseau (rien n'est perdu)
    if (be.id !== 'dir' && !B.net.online) return { pulled: 0, pushed: 0, offline: true };
    await S.flush();
    const remote = await be.list(); // Map id -> { u, ...ref }
    const pulled = [], toRemote = [];
    for (const [id, r] of remote) {
      const m = S.lessons.get(id);
      if (!m || (r.u || 0) > (m.updatedAt || 0)) {
        const l = await be.read(r).catch((e) => { console.warn('illisible', id, e); return null; });
        if (l && l.id === id && (!m || (l.updatedAt || 0) > (m.updatedAt || 0))) { S.lessons.set(id, l); pulled.push(l); }
      } else if ((m.updatedAt || 0) > (r.u || 0)) toRemote.push(m);
    }
    for (const [id, m] of S.lessons) if (!remote.has(id)) toRemote.push(m);
    if (pulled.length) await tx('lessons', 'readwrite', (s) => pulled.forEach((l) => s.put(l)));
    for (const l of toRemote) await be.write(l);
    // ce qui vient d'arriver est recopié vers les autres destinations (ex. Drive -> dossier du PC)
    for (const other of ready()) if (other !== be) for (const l of pulled) await other.write(l).catch(() => {});
    // audio enregistré ici mais absent de la destination : on l'envoie
    const names = await be.audioNames();
    for (const l of S.lessons.values()) {
      if (l.deleted) continue;
      for (const r of l.recordings || []) {
        if (names.has(r.file)) continue;
        const b = await idbAudio(r.id);
        if (b) await be.audioPut(r, b).catch((e) => console.warn('audio', e));
      }
    }
    // images présentes ici mais absentes de la destination : on les envoie
    if (be.imgNames) {
      const inames = await be.imgNames();
      for (const l of S.lessons.values()) {
        if (l.deleted) continue;
        for (const f of picsOf(l)) {
          if (inames.has(f)) continue;
          const b = await idbImage(f);
          if (b) { await be.imgPut(f, b).catch((e) => console.warn('image', e)); inames.add(f); }
        }
      }
    }
    if (be.after) await be.after();
    S.lastSync = Date.now();
    S.status('Synchronisé · ' + be.label());
    document.dispatchEvent(new CustomEvent('biji:synced', { detail: { from: be.id } }));
    if (pulled.length) document.dispatchEvent(new CustomEvent('biji:lessons', { detail: { pulled: pulled.map((l) => l.id), from: be.id } }));
    return { pulled: pulled.length, pushed: toRemote.length };
  }
  S.syncAll = async function () {
    for (const be of ready()) await S.sync(be);
    document.dispatchEvent(new CustomEvent('biji:sync'));
  };

  /* ---------- dossier sur le disque ---------- */
  const queues = new Map();
  async function fileHandle(path, create) {
    const parts = path.split('/');
    let d = S.dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
    return d.getFileHandle(parts[parts.length - 1], { create });
  }
  function writeFile(path, data) {
    if (S.dirState !== 'granted') return Promise.resolve(false);
    const prev = queues.get(path) || Promise.resolve();
    const p = prev.then(async () => {
      const fh = await fileHandle(path, true);
      const w = await fh.createWritable();
      await w.write(data instanceof Blob || typeof data === 'string' ? data : JSON.stringify(data, null, 1));
      await w.close();
      return true;
    }).catch((e) => {
      console.error(e);
      S.status('Échec d’écriture dans le dossier : ' + e.message, true);
      return false;
    });
    queues.set(path, p);
    return p;
  }
  const folder = {
    id: 'dir',
    label: () => 'dossier « ' + (S.dir ? S.dir.name : '') + ' »',
    ready: () => S.dirState === 'granted' && !!S.dir,
    async list() {
      const out = new Map();
      for await (const [name, h] of S.dir.entries()) {
        if (h.kind !== 'file' || !/^c[\w]+\.json$/.test(name)) continue;
        try {
          const l = JSON.parse(await (await h.getFile()).text());
          if (l && l.id) out.set(l.id, { u: l.updatedAt || 0, data: l });
        } catch (e) {
          console.warn('Fichier illisible ignoré', name, e);
        }
      }
      return out;
    },
    read: async (r) => r.data,
    write: (l) => writeFile(l.id + '.json', l),
    async audioNames() {
      const out = new Set();
      try { for await (const [n] of (await S.dir.getDirectoryHandle('audio')).entries()) out.add(n); } catch (e) { /* pas encore de dossier audio */ }
      return out;
    },
    audioPut: (rec, blob) => writeFile('audio/' + rec.file, blob),
    async audioGet(rec) {
      try { return await (await fileHandle('audio/' + rec.file, false)).getFile(); } catch (e) { return null; }
    },
    async audioDel(rec) {
      try { await (await S.dir.getDirectoryHandle('audio')).removeEntry(rec.file); } catch (e) { /* déjà absent */ }
    },
    async imgNames() {
      const out = new Set();
      try { for await (const [n] of (await S.dir.getDirectoryHandle('images')).entries()) out.add(n); } catch (e) { /* pas encore de dossier images */ }
      return out;
    },
    imgPut: (file, blob) => writeFile('images/' + file, blob),
    async imgGet(file) {
      try { return await (await fileHandle('images/' + file, false)).getFile(); } catch (e) { return null; }
    },
    async after() {
      if (!(await S.dir.getFileHandle('LISEZMOI.txt').catch(() => null))) {
        await writeFile('LISEZMOI.txt', 'Notes Biji : un fichier JSON par cours, les enregistrements dans audio/, les images dans images/. Ne pas renommer les fichiers.\n');
      }
    },
  };
  S.register(folder);

  S.pickDir = async function () {
    if (!window.showDirectoryPicker) {
      B.toast('Ce navigateur ne sait pas écrire dans un dossier : utiliser Chrome ou Edge sur PC (ou la synchro Google Drive)', 5000);
      return false;
    }
    let h;
    try {
      h = await showDirectoryPicker({ id: 'biji', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      return false; // annulé
    }
    S.dir = h;
    S.dirState = 'granted';
    await S.kvSet('dir', h);
    await S.syncFromDir();
    return true;
  };
  S.reconnect = async function () {
    if (!S.dir) return S.pickDir();
    const r = await S.dir.requestPermission({ mode: 'readwrite' });
    S.dirState = r === 'granted' ? 'granted' : 'prompt';
    if (S.dirState === 'granted') await S.syncFromDir();
    return S.dirState === 'granted';
  };
  S.forgetDir = async function () {
    S.dir = null;
    S.dirState = 'none';
    await S.kvSet('dir', null);
  };
  S.syncFromDir = () => S.sync(folder);

  /* ---------- synchro périodique (Drive : autres appareils) ---------- */
  const auto = () => { if (!document.hidden && B.net.online && S.backends.some((b) => b.id !== 'dir' && b.ready())) S.syncAll(); };
  setInterval(auto, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(auto, 300); });

  /* ---------- export / import (sauvegarde manuelle, sans l'audio) ---------- */
  const toDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  S.exportAll = async function () {
    await S.flush();
    const images = {};
    for (const l of S.lessons.values()) {
      if (l.deleted) continue;
      for (const f of picsOf(l)) if (!images[f]) { const b = await S.getImage(f).catch(() => null); if (b) images[f] = await toDataUrl(b); }
    }
    const data = { app: 'biji', version: 2, exportedAt: new Date().toISOString(), lessons: [...S.lessons.values()], images };
    const a = B.h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: 'biji-sauvegarde-' + B.today() + '.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  S.importFile = async function (file) {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'biji' || !Array.isArray(data.lessons)) throw new Error('Ce fichier n’est pas une sauvegarde Biji');
    for (const [f, url] of Object.entries(data.images || {})) {
      if (!/^[\w.-]+$/.test(f) || (await idbImage(f))) continue;
      await S.saveImage(f, await (await fetch(url)).blob()).catch((e) => console.warn('image importée', f, e));
    }
    let n = 0;
    for (const l of data.lessons) {
      const m = S.lessons.get(l.id);
      if (!m || (l.updatedAt || 0) > (m.updatedAt || 0)) {
        S.lessons.set(l.id, l);
        pending.set(l.id, l);
        n++;
      }
    }
    await S.flush();
    document.dispatchEvent(new CustomEvent('biji:lessons'));
    return n;
  };

  S.status = function (msg, err) {
    const el = B.$('#savestate');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('err', !!err);
  };
})();
