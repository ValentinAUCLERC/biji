// Mode « stylet d'abord » (headless Chromium) : npm run build && node tests/penfirst.js
// Le stylet fait défiler hors des dessins, toucher place le curseur, appui maintenu = sélection ; souris et doigt ne dessinent pas.
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
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
  const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
  const ev = (f, a) => p.evaluate(f, a);
  const mouse = (type, x, y, pointerType, extra = {}) => cdp.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, pointerType,
    button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left', buttons: extra.buttons || 0, clickCount: 1, force: pointerType === 'pen' ? 0.6 : 0 }, extra));
  async function drag(pointerType, pts, holdMs = 0) {
    await mouse('mouseMoved', pts[0][0], pts[0][1], pointerType);
    await mouse('mousePressed', pts[0][0], pts[0][1], pointerType, { buttons: 1 });
    if (holdMs) await p.waitForTimeout(holdMs);
    for (const [x, y] of pts.slice(1)) { await mouse('mouseMoved', x, y, pointerType, { buttons: 1 }); await p.waitForTimeout(8); }
    const l = pts[pts.length - 1];
    await mouse('mouseReleased', l[0], l[1], pointerType);
    await p.waitForTimeout(120);
  }
  const line = (x0, y0, x1, y1, n = 14) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

  await p.goto(BASE + '?nosw#/');
  await p.click('#page button:has-text("+ Nouveau cours")');
  await p.waitForSelector('.ProseMirror');
  await ev(() => {
    const html = Array.from({ length: 50 }, (_, i) => '<p>Ligne ' + (i + 1) + ' : 你好 学生 nǐ hǎo</p>').join('');
    Biji.editor.editor.chain().focus().insertContent(html).run();
  });
  await p.click('.fmtbar button:has-text("✏ Dessin")');
  await p.waitForSelector('.nv-ink canvas');
  await ev(() => Biji.editor.editor.chain().focus('end').insertContent('<p>fin</p>').setTextSelection(1).run());

  /* ---- activer le mode ---- */
  await p.click('#penbtn');
  ok(await ev(() => Biji.settings.penFirst && document.body.classList.contains('penfirst')), 'bouton ✒ Stylet : mode activé');

  /* ---- dessin : stylet oui, souris non ---- */
  await p.$eval('.nv-ink', (e) => e.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  let box = await (await p.$('.nv-ink canvas')).boundingBox();
  const strokes = () => ev(() => Object.values(Biji.editor.lesson.inks)[0].length);
  await drag('mouse', line(box.x + 40, box.y + 60, box.x + 300, box.y + 80));
  ok(await strokes() === 0, 'souris sur un dessin : ne trace pas');
  await drag('pen', line(box.x + 40, box.y + 60, box.x + 300, box.y + 80));
  ok(await strokes() === 1, 'stylet sur un dessin : trace');

  /* ---- stylet sur le texte : défile, sans sélectionner ---- */
  await ev(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  const para = await (await p.$('.ProseMirror p:nth-child(8)')).boundingBox();
  const y0 = await ev(() => window.scrollY);
  await drag('pen', line(para.x + 200, 600, para.x + 205, 250, 20));
  await p.waitForTimeout(700); // élan
  const y1 = await ev(() => window.scrollY);
  ok(y1 - y0 > 300, 'stylet glissé vers le haut sur le texte : la page défile de ' + (y1 - y0) + ' px');
  ok(await ev(() => Biji.editor.editor.state.selection.empty), 'défilement au stylet : aucun texte sélectionné');
  await drag('pen', line(para.x + 200, 250, para.x + 200, 550, 20));
  await p.waitForTimeout(700);
  ok(await ev(() => window.scrollY) < y1, 'stylet glissé vers le bas : la page remonte');

  /* ---- toucher = curseur ---- */
  await p.$eval('.ProseMirror p:nth-child(12)', (e) => e.scrollIntoView({ block: 'center' }));
  const tgt = await (await p.$('.ProseMirror p:nth-child(12)')).boundingBox();
  await drag('pen', [[tgt.x + 30, tgt.y + tgt.height / 2]]);
  const cur = await ev(() => { const s = Biji.editor.editor.state.selection; return { empty: s.empty, text: s.$from.parent.textContent }; });
  ok(cur.empty && /Ligne 12/.test(cur.text), 'toucher au stylet : curseur placé dans la ligne touchée (' + cur.text.slice(0, 9) + ')');

  /* ---- appui maintenu + glisser = sélection ---- */
  await p.$eval('.ProseMirror p:nth-child(13)', (e) => e.scrollIntoView({ block: 'center' }));
  const s0 = await (await p.$('.ProseMirror p:nth-child(13)')).boundingBox();
  await drag('pen', line(s0.x + 10, s0.y + s0.height / 2, s0.x + 140, s0.y + s0.height / 2, 8), 650);
  const sel = await ev(() => { const s = Biji.editor.editor.state; return s.doc.textBetween(s.selection.from, s.selection.to); });
  ok(sel.length >= 4 && /igne 13/.test(sel), 'appui maintenu puis glisser : texte sélectionné « ' + sel + ' »');

  /* ---- souris : sélection normale conservée ---- */
  await ev(() => Biji.editor.editor.commands.setTextSelection(1));
  await p.$eval('.ProseMirror p:nth-child(14)', (e) => e.scrollIntoView({ block: 'center' }));
  const m0 = await (await p.$('.ProseMirror p:nth-child(14)')).boundingBox();
  await drag('mouse', line(m0.x + 10, m0.y + m0.height / 2, m0.x + 140, m0.y + m0.height / 2, 8));
  ok(!(await ev(() => Biji.editor.editor.state.selection.empty)), 'souris glissée sur le texte : sélection normale');

  /* ---- mode désactivé : comportement d'avant ---- */
  await p.click('#penbtn');
  await p.$eval('.nv-ink', (e) => e.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  box = await (await p.$('.nv-ink canvas')).boundingBox();
  await drag('mouse', line(box.x + 40, box.y + 120, box.x + 300, box.y + 140));
  ok(await strokes() === 2, 'mode désactivé : la souris dessine de nouveau');

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await b.close();
  srv.close();
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
