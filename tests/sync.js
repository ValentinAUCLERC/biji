// Test du stockage dossier (OPFS = même API FileSystemDirectoryHandle que le dossier choisi par showDirectoryPicker)
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.BASE || 'http://127.0.0.1:8765/index.html');
  await p.waitForFunction(() => Biji.lex.ready);
  const r = await p.evaluate(async () => {
    const S = Biji.store, out = {};
    const dir = await navigator.storage.getDirectory();
    for await (const [n] of dir.entries()) await dir.removeEntry(n, { recursive: true });
    const a = S.create({ title: 'Avant dossier' });           // existe seulement dans le navigateur
    await S.flush();
    S.dir = dir; S.dirState = 'granted';
    await S.syncFromDir();                                     // doit écrire le cours existant dans le dossier
    out.afterConnect = [];
    for await (const [n] of dir.entries()) out.afterConnect.push(n);
    const f = JSON.parse(await (await (await dir.getFileHandle(a.id + '.json')).getFile()).text());
    out.fileTitle = f.title;
    // édition « ailleurs » (autre PC via OneDrive) : fichier plus récent -> doit gagner
    f.title = 'Modifié sur l’autre PC'; f.updatedAt = Date.now() + 1000;
    const w = await (await dir.getFileHandle(a.id + '.json')).createWritable(); await w.write(JSON.stringify(f)); await w.close();
    // nouveau cours créé ailleurs
    const other = { id: 'cautre1', title: 'Cours de l’autre PC', date: '2026-11-01', createdAt: 1, updatedAt: Date.now(), blocks: [], vocab: [] };
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
  const ok = r.afterConnect.length === 2 && r.fileTitle === 'Avant dossier' && r.titles.includes('Modifié sur l’autre PC') && r.titles.includes('Cours de l’autre PC')
    && r.fileAfterEdit === 'Édité ici' && r.afterDelete.length === 1 && !errs.length;
  console.log(ok ? 'OK   synchro dossier' : 'FAIL synchro dossier ' + errs.join(' | '));
  if (!ok) process.exitCode = 1;
  await b.close();
})();
