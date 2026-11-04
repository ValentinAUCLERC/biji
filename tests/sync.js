// Test du stockage dossier (OPFS = même API FileSystemDirectoryHandle que le dossier choisi par showDirectoryPicker)
// npm run build && node tests/sync.js  (sert site/ sur un port local)
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const root = path.resolve(__dirname, '../site');
  const srv = http.createServer((q, r) => {
    let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); } });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/?nosw`);
  await p.waitForFunction(() => Biji.lex.ready);
  const r = await p.evaluate(async () => {
    const S = Biji.store, out = {};
    const dir = await navigator.storage.getDirectory();
    for await (const [n] of dir.entries()) await dir.removeEntry(n, { recursive: true });
    const a = S.create({ title: 'Avant dossier', doc: { type: 'doc', content: [{ type: 'paragraph' }] } }); // seulement dans le navigateur
    // enregistrement audio fait avant de connecter le dossier
    const rec = { id: 'rtest', file: a.id + '-test.webm', title: 'Cours', startedAt: Date.now(), dur: 1000, size: 4 };
    a.recordings = [rec]; S.touch(a);
    await S.saveAudio(rec, new Blob([new Uint8Array([26, 69, 223, 163])], { type: 'audio/webm' }));
    await S.flush();
    S.dir = dir; S.dirState = 'granted';
    await S.syncFromDir();                                     // doit écrire le cours existant dans le dossier
    out.afterConnect = [];
    for await (const [n] of dir.entries()) out.afterConnect.push(n);
    const f = JSON.parse(await (await (await dir.getFileHandle(a.id + '.json')).getFile()).text());
    out.fileTitle = f.title;
    out.audioFile = (await (await (await dir.getDirectoryHandle('audio')).getFileHandle(rec.file)).getFile()).size;
    // édition « ailleurs » (autre PC via OneDrive) : fichier plus récent -> doit gagner
    f.title = 'Modifié sur l’autre PC'; f.updatedAt = Date.now() + 1000;
    const w = await (await dir.getFileHandle(a.id + '.json')).createWritable(); await w.write(JSON.stringify(f)); await w.close();
    // nouveau cours créé ailleurs
    const other = { id: 'cautre1', title: 'Cours de l’autre PC', date: '2026-11-01', createdAt: 1, updatedAt: Date.now(), blocks: [{ id: 'b1', type: 'text', text: '你好' }], vocab: [] };
    const w2 = await (await dir.getFileHandle('cautre1.json', { create: true })).createWritable(); await w2.write(JSON.stringify(other)); await w2.close();
    await S.syncFromDir();
    out.titles = S.list().map((l) => l.title).sort();
    // édition locale -> fichier mis à jour
    const l = S.get(a.id); l.title = 'Édité ici'; S.touch(l); await S.flush();
    out.fileAfterEdit = JSON.parse(await (await (await dir.getFileHandle(a.id + '.json')).getFile()).text()).title;
    // suppression -> pierre tombale, pas de résurrection
    S.remove('cautre1'); await S.flush(); await S.syncFromDir();
    out.afterDelete = S.list().map((l) => l.title);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = r.afterConnect.includes(r.afterConnect.find((n) => n.endsWith('.json'))) && r.afterConnect.includes('audio') && r.audioFile === 4 && r.fileTitle === 'Avant dossier' && r.titles.includes('Modifié sur l’autre PC') && r.titles.includes('Cours de l’autre PC')
    && r.fileAfterEdit === 'Édité ici' && r.afterDelete.length === 1 && !errs.length;
  console.log(ok ? 'OK   synchro dossier' : 'FAIL synchro dossier ' + errs.join(' | '));
  if (!ok) process.exitCode = 1;
  await b.close();
  srv.close();
})();
