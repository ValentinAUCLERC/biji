// Images et PDF annotables (headless Chromium) : npm run build && node tests/media.js
// Fichier, collage, glisser-déposer, PDF (choix des pages, texte cherchable), annotation au stylet, rechargement, export/import.
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'biji-media');
fs.mkdirSync(OUT, { recursive: true });

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    let f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve(path.resolve(__dirname, '../site'));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

  /* ---- fixtures : PDF de 3 pages (texte chinois) généré par Chromium, grande photo PNG ---- */
  const gen = await (await b.newContext()).newPage();
  await gen.setContent(`<html><body style="font:28px sans-serif">
    <section style="page-break-after:always"><h1>Leçon 3 : 你好</h1><p>nǐ hǎo — bonjour</p></section>
    <section style="page-break-after:always"><h1>Page deux : 谢谢</h1><p>xièxie — merci</p></section>
    <section><h1>Page trois : 再见</h1><p>zàijiàn — au revoir</p><div style="width:300px;height:200px;background:#c8382b"></div></section></body></html>`);
  const pdfPath = path.join(OUT, 'lecon3.pdf');
  fs.writeFileSync(pdfPath, await gen.pdf({ format: 'A4' }));
  const pngB64 = await gen.evaluate(async () => {
    const c = new OffscreenCanvas(4000, 3000), x = c.getContext('2d');
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9},70%,60%)`; x.fillRect(i * 100, 0, 100, 3000); }
    const bl = await c.convertToBlob({ type: 'image/png' });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(bl); });
  }).catch(async () => null);
  const photoPath = path.join(OUT, 'photo-tableau.png');
  if (pngB64) fs.writeFileSync(photoPath, Buffer.from(pngB64, 'base64'));
  await gen.close();

  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  const ev = (f, a) => p.evaluate(f, a);
  const cdp = await ctx.newCDPSession(p);
  const pen = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons: buttons || 0, clickCount: 1, force: 0.6 });
  async function penStroke(pts) {
    await pen('mouseMoved', pts[0][0], pts[0][1]);
    await pen('mousePressed', pts[0][0], pts[0][1], 1);
    for (const [x, y] of pts.slice(1)) { await pen('mouseMoved', x, y, 1); await p.waitForTimeout(6); }
    await pen('mouseReleased', pts[pts.length - 1][0], pts[pts.length - 1][1]);
    await p.waitForTimeout(100);
  }
  const lesson = () => ev(() => { Biji.editor.syncDoc(); return JSON.parse(JSON.stringify(Biji.editor.lesson)); });
  const pics = () => ev(() => [...document.querySelectorAll('.nv-pic')].map((n) => n.querySelector('.nvl').textContent));
  const shown = (i) => p.waitForFunction((i) => {
    const cv = document.querySelectorAll('.nv-pic canvas')[i];
    if (!cv || !cv.width) return false;
    const d = cv.getContext('2d').getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data;
    return !(d[0] === 0xf3 && d[1] === 0xef && d[2] === 0xe6) && d[3] > 0; // pas le fond « Chargement… »
  }, i, { timeout: 15000 }).then(() => true).catch(() => false);

  await p.goto(BASE + '?nosw#/');
  await p.click('#page button:has-text("+ Nouveau cours")');
  await p.waitForSelector('.ProseMirror');
  await p.keyboard.type('Photo du tableau :');

  /* ---- 1. fichier image (grande photo réduite) ---- */
  if (pngB64) {
    await p.click('.fmtbar button.dd:has-text("Image / PDF")');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.fmtbar .pop button:has-text("Depuis un fichier")')]);
    ok(fc.isMultiple(), 'sélecteur de fichiers : plusieurs fichiers possibles');
    await fc.setFiles(photoPath);
    await p.waitForSelector('.nv-pic');
    ok(await shown(0), 'photo affichée dans le cours');
    const L = await lesson();
    const pic = L.doc.content.find((n) => n.type === 'pic');
    const blob = await ev((f) => Biji.store.getImage(f).then((b) => ({ size: b.size, type: b.type })), pic.attrs.file);
    ok(pic.attrs.w === 2000 && pic.attrs.h === 1500, 'photo 4000×3000 réduite à ' + pic.attrs.w + '×' + pic.attrs.h);
    ok(blob.size < 600000 && /webp|jpeg/.test(blob.type), 'photo stockée compressée : ' + Math.round(blob.size / 1024) + ' Ko (' + blob.type + ', origine ' + Math.round(fs.statSync(photoPath).size / 1024) + ' Ko)');
    ok(!JSON.stringify(L).includes('data:image'), 'l’image n’est pas dans le JSON du cours');
    const cam = await ev(() => { const btn = [...document.querySelectorAll('.fmtbar .pop button')].find((x) => /photo/.test(x.textContent)); return !!btn; });
    ok(cam, 'menu : « 📷 Prendre en photo »');
  }

  /* ---- 2. annotation au stylet sur l'image ---- */
  await p.$eval('.nv-pic', (e) => e.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  let box = await (await p.$('.nv-pic canvas')).boundingBox();
  await penStroke(Array.from({ length: 15 }, (_, i) => [box.x + 100 + i * 20, box.y + box.height / 2]));
  let L = await lesson();
  const pid = L.doc.content.find((n) => n.type === 'pic').attrs.id;
  ok(L.inks[pid] && L.inks[pid].length === 1, 'trait au stylet enregistré sur l’image');
  const ratio0 = box.height / box.width;
  await p.setViewportSize({ width: 820, height: 900 });
  await p.waitForTimeout(400);
  box = await (await p.$('.nv-pic canvas')).boundingBox();
  ok(Math.abs(box.height / box.width - ratio0) < 0.01, 'fenêtre plus étroite : l’image garde ses proportions (les traits suivent)');
  await p.setViewportSize({ width: 1366, height: 900 });
  await p.screenshot({ path: OUT + '/media-01-photo.png' });

  /* ---- 3. coller une capture (Ctrl+V) ---- */
  await ev(() => Biji.editor.editor.commands.focus('end'));
  await ev(async () => {
    const c = new OffscreenCanvas(600, 300), x = c.getContext('2d');
    x.fillStyle = '#2c8a3e'; x.fillRect(0, 0, 600, 300);
    const f = new File([await c.convertToBlob({ type: 'image/png' })], 'image.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(f);
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForFunction((n) => document.querySelectorAll('.nv-pic').length === n, pngB64 ? 2 : 1, { timeout: 8000 }).catch(() => {});
  ok((await pics()).length === (pngB64 ? 2 : 1), 'capture collée (Ctrl+V) : bloc image ajouté');

  /* ---- 4. glisser-déposer ---- */
  await ev(async () => {
    const c = new OffscreenCanvas(500, 500), x = c.getContext('2d');
    x.fillStyle = '#8a3fb0'; x.fillRect(0, 0, 500, 500);
    const f = new File([await c.convertToBlob({ type: 'image/jpeg' })], 'fiche.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(f);
    const pm = document.querySelector('.ProseMirror p');
    const r = pm.getBoundingClientRect();
    pm.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
  });
  await p.waitForFunction((n) => document.querySelectorAll('.nv-pic').length === n, pngB64 ? 3 : 2, { timeout: 8000 }).catch(() => {});
  const capsAfterDrop = await pics();
  ok(capsAfterDrop.some((c) => /fiche/.test(c)), 'fichier glissé-déposé : bloc « fiche » ajouté (' + capsAfterDrop.join(' | ') + ')');

  /* ---- 5. PDF : choix des pages, rendu, texte cherchable ---- */
  await ev(() => Biji.editor.editor.commands.focus('end'));
  await p.click('.fmtbar button.dd:has-text("Image / PDF")');
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('.fmtbar .pop button:has-text("Depuis un fichier")')]);
  await fc2.setFiles(pdfPath);
  await p.waitForSelector('#pdfdlg[open]', { timeout: 20000 });
  ok(/3 pages/.test(await p.$eval('#pdfdlg', (d) => d.textContent)), 'PDF : fenêtre « 3 pages »');
  ok((await p.$eval('#pdfpages', (i) => i.value)) === '1-3', 'PDF : toutes les pages proposées par défaut (1-3)');
  await p.screenshot({ path: OUT + '/media-02-pdf-dialog.png' });
  await p.fill('#pdfpages', '9');
  await p.click('#pdfok');
  ok(await p.$('#pdfdlg[open]') != null && /Aucune page valide/.test(await p.$eval('#pdfdlg', (d) => d.textContent)), 'PDF : page inexistante refusée');
  await p.fill('#pdfpages', '1, 3');
  await p.click('#pdfok');
  await p.waitForFunction(() => [...document.querySelectorAll('.nv-pic .nvl')].filter((e) => /lecon3/.test(e.textContent)).length === 2, null, { timeout: 30000 }).catch(() => {});
  const caps = await pics();
  ok(caps.filter((c) => /lecon3/.test(c)).length === 2 && caps.some((c) => /p\. 3/.test(c)) && !caps.some((c) => /p\. 2/.test(c)), 'PDF : pages 1 et 3 importées (' + caps.filter((c) => /lecon3/.test(c)).join(' | ') + ')');
  const n = caps.length;
  ok(await shown(n - 1), 'PDF : page 3 rendue en image');
  L = await lesson();
  const p3 = L.doc.content.filter((x) => x.type === 'pic').pop();
  ok(/再见/.test(p3.attrs.text) && p3.attrs.w === 1600, 'PDF : texte de la page gardé pour la recherche (« ' + p3.attrs.text.replace(/\n/g, ' ').slice(0, 30) + '… »), rendu 1600 px');
  await p.$$eval('.nv-pic', (els) => els[els.length - 1].scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(200);
  box = await (await p.$$('.nv-pic canvas')).pop().boundingBox();
  await penStroke(Array.from({ length: 12 }, (_, i) => [box.x + 60 + i * 25, box.y + 120 + i * 4]));
  L = await lesson();
  ok(L.inks[p3.attrs.id].length === 1, 'PDF : annotation au stylet sur la page');
  await p.screenshot({ path: OUT + '/media-03-pdf-annote.png' });

  /* ---- 6. recherche, rechargement ---- */
  const lid = L.id;
  await ev(() => Biji.store.flush());
  await p.goto(BASE + '?nosw#/');
  await p.waitForSelector('#side');
  const found = await ev(() => { const i = document.querySelector('#side input[type=search], #side .search input, input[type=search]'); if (!i) return null; i.value = '再见'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; });
  await p.waitForTimeout(400);
  if (found) ok(await ev((lid) => !!document.querySelector('#side a[href="#/c/' + lid + '"]'), lid), 'recherche « 再见 » : trouve le cours grâce au texte du PDF');
  await p.reload();
  await p.goto(BASE + '?nosw#/c/' + lid);
  await p.waitForSelector('.nv-pic canvas');
  let all = true;
  const cnt = await p.$$eval('.nv-pic', (e) => e.length);
  for (let i = 0; i < cnt; i++) all = (await shown(i)) && all;
  ok(all && cnt === n, 'après rechargement : les ' + cnt + ' images s’affichent (hors ligne, depuis le navigateur)');
  L = await lesson();
  ok(L.inks[p3.attrs.id].length === 1 && L.inks[pid].length === 1, 'après rechargement : annotations conservées');

  /* ---- 7. export -> import sur un autre navigateur ---- */
  await p.goto(BASE + '?nosw#/reglages');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Exporter une sauvegarde")')]);
  const bak = path.join(OUT, 'sauvegarde.json');
  await dl.saveAs(bak);
  const data = JSON.parse(fs.readFileSync(bak, 'utf8'));
  ok(Object.keys(data.images || {}).length === n, 'export : ' + Object.keys(data.images || {}).length + ' images incluses dans la sauvegarde');
  const p2 = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  p2.on('pageerror', (e) => errs.push('p2: ' + e.message));
  await p2.goto(BASE + '?nosw#/reglages');
  await p2.waitForSelector('input[type=file]', { state: 'attached' });
  await p2.setInputFiles('input[type=file]', bak);
  await p2.waitForTimeout(1200);
  await p2.goto(BASE + '?nosw#/c/' + lid);
  await p2.waitForSelector('.nv-pic canvas');
  const ok2 = await p2.waitForFunction(() => [...document.querySelectorAll('.nv-pic canvas')].every((cv) => {
    if (!cv.width) return false;
    const d = cv.getContext('2d').getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data;
    return !(d[0] === 0xf3 && d[1] === 0xef && d[2] === 0xe6);
  }), null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(ok2, 'import sur un autre navigateur : images et cours restaurés');

  /* ---- 8. téléphone : bouton photo, mise en page ---- */
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await ph.goto(BASE + '?nosw#/reglages');
  await ph.setInputFiles('input[type=file]', bak);
  await ph.waitForTimeout(1200);
  await ph.goto(BASE + '?nosw#/c/' + lid);
  await ph.waitForSelector('.nv-pic canvas');
  await ph.waitForTimeout(1200);
  const over = await ph.evaluate(() => [...document.querySelectorAll('.nv-pic canvas')].some((c) => c.getBoundingClientRect().right > innerWidth + 1));
  ok(!over, 'téléphone : les images tiennent dans la largeur de l’écran');
  await ph.$$eval('.nv-pic', (els) => els[els.length - 1].scrollIntoView({ block: 'start' }));
  await ph.screenshot({ path: OUT + '/media-04-tel.png' });

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await b.close();
  srv.close();
  console.log('captures : ' + OUT);
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
