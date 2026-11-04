/* Biji — stockage : IndexedDB (toujours) + dossier sur le disque (File System Access, Chrome/Edge)
 * Un cours = un fichier <id>.json dans le dossier choisi. Le plus récent (updatedAt) gagne à la fusion.
 * Suppression = « pierre tombale » {id, deleted:true} pour qu'un vieux fichier ne ressuscite pas le cours. */
(function () {
  const B = window.Biji;
  const S = (B.store = { lessons: new Map(), dir: null, dirState: 'none' /* none | granted | prompt */ });

  let dbp = null;
  function db() {
    return (dbp = dbp || new Promise((res, rej) => {
      const q = indexedDB.open('biji', 1);
      q.onupgradeneeded = () => {
        q.result.createObjectStore('lessons', { keyPath: 'id' });
        q.result.createObjectStore('kv');
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
  S.kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  S.kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

  S.init = async function () {
    const all = await tx('lessons', 'readonly', (s) => s.getAll());
    all.forEach((l) => S.lessons.set(l.id, l));
    const h = await S.kvGet('dir').catch(() => null);
    if (h) {
      S.dir = h;
      S.dirState = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
      if (S.dirState === 'granted') await S.syncFromDir();
    }
  };

  S.list = () => [...S.lessons.values()].filter((l) => !l.deleted)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  S.get = (id) => { const l = S.lessons.get(id); return l && !l.deleted ? l : null; };

  /* ---------- écriture ---------- */
  const queues = new Map();
  function writeFile(name, data) {
    if (S.dirState !== 'granted') return Promise.resolve(false);
    const prev = queues.get(name) || Promise.resolve();
    const p = prev.then(async () => {
      const fh = await S.dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(data, null, 1));
      await w.close();
      return true;
    }).catch((e) => {
      console.error(e);
      S.status('Échec d’écriture dans le dossier : ' + e.message, true);
      return false;
    });
    queues.set(name, p);
    return p;
  }

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
    const items = [...pending.values()];
    pending.clear();
    if (!items.length) return;
    await tx('lessons', 'readwrite', (s) => items.forEach((l) => s.put(l)));
    let disk = true;
    for (const l of items) disk = (await writeFile(l.id + '.json', l)) && disk;
    S.status(S.dirState === 'granted' && disk ? 'Enregistré dans « ' + S.dir.name + ' »' : 'Enregistré dans le navigateur seulement');
  };
  window.addEventListener('pagehide', () => S.flush());
  document.addEventListener('visibilitychange', () => document.hidden && S.flush());

  S.create = function (fields) {
    const l = Object.assign({ id: 'c' + B.uid(), title: '', date: B.today(), createdAt: Date.now(), blocks: [], vocab: [] }, fields);
    S.touch(l);
    return l;
  };
  S.remove = function (id) {
    const l = S.lessons.get(id);
    if (!l) return;
    S.touch({ id, deleted: true, title: l.title, createdAt: l.createdAt });
  };

  /* ---------- dossier ---------- */
  S.pickDir = async function () {
    if (!window.showDirectoryPicker) {
      B.toast('Ce navigateur ne sait pas écrire dans un dossier : utiliser Chrome ou Edge', 5000);
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

  /** Fusion dossier <-> navigateur : le plus récent gagne, puis on réécrit des deux côtés */
  S.syncFromDir = async function () {
    const onDisk = new Map();
    for await (const [name, h] of S.dir.entries()) {
      if (h.kind !== 'file' || !/^c[\w]+\.json$/.test(name)) continue;
      try {
        const l = JSON.parse(await (await h.getFile()).text());
        if (l && l.id) onDisk.set(l.id, l);
      } catch (e) {
        console.warn('Fichier illisible ignoré', name, e);
      }
    }
    const toIdb = [], toDisk = [];
    for (const [id, d] of onDisk) {
      const m = S.lessons.get(id);
      if (!m || (d.updatedAt || 0) > (m.updatedAt || 0)) { S.lessons.set(id, d); toIdb.push(d); }
      else if ((m.updatedAt || 0) > (d.updatedAt || 0)) toDisk.push(m);
    }
    for (const [id, m] of S.lessons) if (!onDisk.has(id)) toDisk.push(m);
    if (toIdb.length) await tx('lessons', 'readwrite', (s) => toIdb.forEach((l) => s.put(l)));
    for (const l of toDisk) await writeFile(l.id + '.json', l);
    if (!(await S.dir.getFileHandle('LISEZMOI.txt').catch(() => null))) {
      await writeFile('LISEZMOI.txt', 'Notes Biji : un fichier JSON par cours. Ne pas renommer les fichiers.\n');
    }
    S.status('Synchronisé avec « ' + S.dir.name + ' »');
    document.dispatchEvent(new CustomEvent('biji:lessons'));
  };

  /* ---------- export / import (sauvegarde manuelle) ---------- */
  S.exportAll = function () {
    const data = { app: 'biji', version: 1, exportedAt: new Date().toISOString(), lessons: [...S.lessons.values()] };
    const a = B.h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: 'biji-sauvegarde-' + B.today() + '.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  S.importFile = async function (file) {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'biji' || !Array.isArray(data.lessons)) throw new Error('Ce fichier n’est pas une sauvegarde Biji');
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
