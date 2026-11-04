// Test de bout en bout V2 (headless Chromium) : npm run build && node tests/e2e.js
// Variables : OUT=dossier des captures, BASE=url (défaut : serveur http local sur site/), PW=chemin playwright-core
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || '/tmp/biji-shots';
fs.mkdirSync(OUT, { recursive: true });

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
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
  const srv = process.env.BASE ? null : await serve(path.resolve(__dirname, '../site'));
  const BASE = process.env.BASE || `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/inputtools|favicon/.test(m.text()) && errs.push('console: ' + m.text()));
  const cdp = await ctx.newCDPSession(p);
  let fails = 0;
  const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fails++; };
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const ev = (f, a) => p.evaluate(f, a);

  async function penStroke(pts, opts = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1], pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
    for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.7 });
    const l = pts[pts.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    if (opts.wait !== false) await p.waitForTimeout(80);
  }
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  /** Bout gomme : événements pointer synthétiques (button 5 / buttons 32, comme Chrome sous Windows) */
  const eraserStroke = (sel, pts) => ev(([sel, pts]) => {
    const c = document.querySelector(sel);
    const mk = (type, x, y, extra) => c.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.5 }, extra)));
    mk('pointerdown', pts[0][0], pts[0][1], { button: 5, buttons: 32 });
    for (const [x, y] of pts.slice(1)) mk('pointermove', x, y, { button: -1, buttons: 32 });
    const l = pts[pts.length - 1];
    mk('pointerup', l[0], l[1], { button: 5, buttons: 0 });
  }, [sel, pts]);
  /** clic « visuel » au centre d'un caractère (le pinyin ::before fausse le test de cible de Playwright) */
  const clickAt = async (sel) => {
    await p.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
    const r = await p.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
    await p.mouse.click(r[0], r[1]);
  };
  const lesson = () => ev(() => { Biji.editor.syncDoc(); return JSON.parse(JSON.stringify(Biji.editor.lesson)); });

  await p.goto(BASE + '?nosw');
  await p.waitForFunction(() => window.Biji && Biji.lex.ready, null, { timeout: 40000 });
  ok(true, 'dictionnaire chargé');
  await shot('01-accueil');

  /* ---- saisie ---- */
  await p.click('text=+ Nouveau cours');
  await p.waitForSelector('.ProseMirror');
  await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('ProseMirror'));
  await p.keyboard.type('Leçon 1 : se présenter ');
  // Maj seule -> pinyin -> 汉字
  await p.keyboard.press('Shift');
  ok(await ev(() => Biji.ime.on), 'Maj seule active la saisie pinyin');
  await p.keyboard.type('nihao');
  await p.waitForSelector('#imebox:not([hidden]) .ic');
  const top1 = await p.$eval('#imebox .ic.on .w', (e) => e.textContent);
  ok(top1 === '你好', 'nihao propose 你好 en premier : ' + top1);
  const gl = await p.$eval('#imebox .ic.on .g', (e) => e.textContent);
  ok(/bonjour|salut/i.test(gl), 'sens français sous le candidat : ' + gl);
  await shot('02-ime');
  await p.keyboard.press('Space');
  await p.keyboard.type('woshixuesheng');
  await p.keyboard.press('Space');
  await p.keyboard.type('.');
  await p.keyboard.press('Shift');
  ok(!(await ev(() => Biji.ime.on)), 'Maj seule revient au clavier français');
  await p.keyboard.press('Enter');
  await p.keyboard.type('ni3 hao3 = bonjour');
  let txt = await ev(() => Biji.editor.editor.getText());
  ok(txt.includes('你好我是学生。'), 'texte chinois inséré : ' + JSON.stringify(txt.split('\n')[0]));
  ok(txt.includes('nǐ hǎo = bonjour'), 'ni3 hao3 -> nǐ hǎo');
  const pys = await p.$$eval('.hz', (els) => els.map((e) => e.dataset.py).join(' '));
  ok(pys.startsWith('nǐ hǎo wǒ shì xué shēng'), 'pinyin affiché au-dessus : ' + pys);

  /* ---- bloc vide conservé ---- */
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Après deux lignes vides');
  await p.click('.ltitle');
  await p.waitForTimeout(300);
  const paras = await ev(() => Biji.editor.editor.getJSON().content.filter((n) => n.type === 'paragraph').length);
  ok(paras >= 4, 'les paragraphes vides restent après la perte du focus (' + paras + ')');

  /* ---- tableau ---- */
  await p.click('.ProseMirror p:last-child');
  await p.keyboard.press('End');
  await p.click('.fmtbar button.dd:has-text("Tableau")');
  await p.click('text=Insérer 3 × 3');
  await p.keyboard.type('汉字');
  await p.keyboard.press('Tab');
  await p.keyboard.type('pinyin');
  await p.keyboard.press('Tab');
  await p.keyboard.type('sens');
  await p.keyboard.press('Tab');
  await p.keyboard.press('Shift');
  await p.keyboard.type('laoshi');
  await p.keyboard.press('Space');
  await p.keyboard.press('Shift');
  await p.keyboard.press('Tab');
  await p.keyboard.type('lao3 shi1');
  ok(await p.isVisible('.tblbar'), 'barre « Tableau » visible dans un tableau');
  await p.click('.tblbar button:has-text("+ ligne")');
  const rows = await p.$$eval('.ProseMirror table tr', (r) => r.length);
  ok(rows === 4, 'tableau 3 × 3 + 1 ligne : ' + rows + ' lignes');
  ok(await p.$eval('.ProseMirror table', (t) => t.textContent.includes('老师') && t.textContent.includes('lǎo shī')), 'saisie 中 et ni3 dans les cellules');
  await shot('03-tableau');

  /* ---- mise en forme ---- */
  await p.click('.ProseMirror > p:first-child', { clickCount: 3 });
  await p.click('.fmtbar button[data-k="bold"]');
  ok(await p.$('.ProseMirror p:first-child strong') != null, 'gras appliqué');

  /* ---- sélection de pinyin -> 汉字 ---- */
  await ev(() => { const ed = Biji.editor.editor; ed.chain().focus('end').insertContent('<p>zhongguo</p>').run(); });
  await ev(() => { const ed = Biji.editor.editor; const end = ed.state.doc.content.size - 1; ed.commands.setTextSelection({ from: end - 8, to: end }); });
  await p.waitForSelector('#bubble:not([hidden]) .bc .ic');
  const conv = await p.$$eval('#bubble .ic .w', (e) => e.map((x) => x.textContent));
  ok(conv[0] === '中国', 'sélection « zhongguo » → propose 中国 : ' + conv.slice(0, 4).join(' '));
  await shot('04-selection-pinyin');
  await p.click('#bubble .ic');
  txt = await ev(() => Biji.editor.editor.getText());
  ok(txt.trim().endsWith('中国'), 'pinyin remplacé par 中国');

  /* ---- pinyin accentué : ton respecté, écoute, syllabe inexistante ---- */
  await ev(() => { window.__spoken = []; speechSynthesis.speak = (u) => window.__spoken.push(u.text); });
  const selEnd = (t) => ev((t) => { const ed = Biji.editor.editor; ed.chain().focus('end').insertContent('<p>' + t + '</p>').run(); const end = ed.state.doc.content.size - 1; ed.commands.setTextSelection({ from: end - t.length, to: end }); }, t);
  await selEnd('mā');
  await p.waitForSelector('#bubble:not([hidden]) .pybig');
  const exact = await p.$$eval('#bubble .bc:not(.other) .ic .py', (e) => e.map((x) => x.textContent));
  ok(exact.length && exact.every((x) => x === 'mā'), 'sélection « mā » : seuls les mots en mā en premier : ' + exact.join(' '));
  ok(await p.$('#bubble .bc.other .ic') != null, '« même son, autre ton » séparé');
  await p.click('#bubble .bw button.icon');
  ok((await ev(() => window.__spoken))[0] === '妈', 'écouter « mā » → la voix lit 妈');
  await selEnd('rō');
  await p.waitForSelector('#bubble:not([hidden]) .ic.near');
  ok(/n’est pas une syllabe/.test(await p.$eval('#bubble', (e) => e.textContent)), '« rō » : signalé comme non-pinyin');
  await p.click('#bubble .ic.near');
  ok((await ev(() => window.__spoken)).length === 2, '« rō » : syllabes proches à écouter');
  await ev(() => { const ed = Biji.editor.editor; const d = ed.state.doc; const n = d.child(d.childCount - 1).nodeSize + d.child(d.childCount - 2).nodeSize;
    ed.chain().deleteRange({ from: d.content.size - n, to: d.content.size }).setTextSelection(1).run(); });
  await p.keyboard.press('Escape');

  /* ---- clic sur un mot : bulle + vocabulaire + fiche ---- */
  await clickAt('.hz[data-w="学生"]');
  await p.waitForSelector('#bubble[data-mode="word"]:not([hidden])');
  ok(/étudiant|élève/i.test(await p.$eval('#bubble .bg', (e) => e.textContent)), 'bulle : sens de 学生');
  await shot('05-bulle-mot');
  await p.click('#bubble button:has-text("+ Vocabulaire")');
  ok((await lesson()).vocab.some((v) => v.hz === '学生' && v.py === 'xué shēng'), 'ajout au vocabulaire (学生, xué shēng)');
  await clickAt('.hz[data-w="学生"]');
  await p.click('#bubble button:has-text("Fiche")');
  await p.waitForSelector('#card:not([hidden]) .hw svg', { timeout: 10000 });
  ok(true, 'fiche ouverte avec les traits');
  await p.keyboard.press('Escape');
  await p.click('#page .ltitle');
  await p.keyboard.press('Escape');

  /* ---- correction de lecture (polyphone) ---- */
  await ev(() => Biji.editor.editor.chain().focus('end').insertContent('<p>银行</p>').run());
  await p.waitForTimeout(100);
  const hang = await p.$eval('.hz[data-w="银行"][data-wi="1"]', (e) => e.dataset.py);
  ok(hang === 'háng', '银行 : 行 lu háng en contexte : ' + hang);

  /* ---- dessin + gomme ---- */
  await p.click('.fmtbar button:has-text("✏ Dessin")');
  await p.waitForSelector('.nv-ink canvas');
  await p.$eval('.nv-ink', (e) => e.scrollIntoView({ block: 'center' }));
  const box = await (await p.$('.nv-ink canvas')).boundingBox();
  await penStroke(line(box.x + 40, box.y + 60, box.x + 300, box.y + 60));
  await penStroke(line(box.x + 40, box.y + 160, box.x + 300, box.y + 200));
  let L = await lesson();
  const inkId = Object.keys(L.inks)[0];
  ok(L.inks[inkId] && L.inks[inkId].length === 2, 'deux traits dessinés au stylet');
  await eraserStroke('.nv-ink canvas', line(box.x + 150, box.y + 30, box.x + 150, box.y + 90, 6));
  L = await lesson();
  ok(L.inks[inkId].length === 1, 'bout gomme du stylet (button 5 / buttons 32) : trait effacé, reste ' + L.inks[inkId].length);
  ok(await ev(() => Biji.tool.kind) === 'pen', 'l’outil reste « stylo » après la gomme matérielle');
  await shot('06-dessin');

  /* ---- cases 田 ---- */
  await ev(() => Biji.editor.editor.chain().focus('end').run());
  await p.click('.fmtbar button:has-text("田 Cases")');
  await p.fill('.nv-grid .gridchars', '你好');
  await p.waitForSelector('.nv-grid .gridrow:nth-child(2)', { timeout: 5000 });
  ok((await p.$$('.nv-grid .gridrow')).length === 2, 'cases 田 : 2 lignes (你, 好)');

  /* ---- pavé d'écriture ---- */
  await p.keyboard.press('Alt+h');
  await p.waitForSelector('#pad:not([hidden])');
  await ev(() => Biji.editor.editor.chain().focus('end').run());
  const pb = await (await p.$('#padcanvas')).boundingBox();
  const cw = pb.width / 3;
  // 十 dans la 1re case, 一 dans la 2e
  await penStroke(line(pb.x + 15, pb.y + 50, pb.x + cw - 15, pb.y + 50));
  await penStroke(line(pb.x + cw / 2, pb.y + 12, pb.x + cw / 2, pb.y + 92));
  await penStroke(line(pb.x + cw + 15, pb.y + 52, pb.x + 2 * cw - 15, pb.y + 52));
  await p.waitForSelector('#pad .cand', { timeout: 8000 });
  await p.waitForTimeout(800);
  const src = await p.$eval('#pad .src', (e) => e.textContent);
  const cands = await p.$$eval('#pad .cand .ch', (e) => e.map((x) => x.textContent));
  ok(cands.some((c) => c.startsWith('十')), `pavé (${src}) : ${cands.slice(0, 6).join(' ')}`);
  await shot('07-pave');
  await p.click('#pad .cand');
  ok((await ev(() => Biji.editor.editor.getText())).includes(cands[0]), 'candidat inséré dans les notes : ' + cands[0]);
  // hors ligne
  await ev(() => { Biji.settings.onlineHw = false; });
  await penStroke(line(pb.x + 15, pb.y + 50, pb.x + cw - 15, pb.y + 50));
  await penStroke(line(pb.x + cw / 2, pb.y + 12, pb.x + cw / 2, pb.y + 92));
  await p.waitForTimeout(700);
  await p.waitForFunction(() => document.querySelector('#pad .src').textContent === 'hors ligne' && document.querySelector('#pad .cand'), null, { timeout: 15000 })
    .catch(async (e) => { console.log('DBG', await ev(() => [document.querySelector('#pad .src').textContent, document.querySelector('#pad .cands').textContent.slice(0, 80), Biji.settings.onlineHw])); throw e; });
  const off = await p.$$eval('#pad .cand .ch', (e) => e.map((x) => x.textContent));
  ok(off.includes('十'), 'reconnaissance hors ligne : ' + off.slice(0, 6).join(' '));
  await ev(() => { Biji.settings.onlineHw = true; });
  await p.click('#pad header button.icon');

  /* ---- enregistrement ---- */
  await p.click('[data-act="rec"]');
  await p.waitForFunction(() => Biji.rec.state === 'rec', null, { timeout: 8000 });
  await p.waitForTimeout(2600);
  ok(await ev(() => Biji.editor.editor.isFocused), 'le bouton ● Enregistrer ne vole pas le focus des notes');
  await ev(() => Biji.editor.editor.chain().focus('end').run());
  await p.waitForTimeout(50);
  await p.keyboard.press('Alt+m');
  await p.keyboard.type('le prof répète');
  await shot('08-enregistrement');
  await p.waitForTimeout(2600);
  p.once('dialog', (d) => d.accept());
  await p.click('[data-act="rec"]');
  await p.waitForFunction(() => Biji.rec.state === 'idle' && Biji.editor.lesson.recordings.length === 1, null, { timeout: 10000 });
  L = await lesson();
  const rec = L.recordings[0];
  ok(rec.dur > 4000 && rec.size > 1000, `enregistrement sauvé : ${Math.round(rec.dur / 1000)} s, ${rec.size} octets, ${rec.type}`);
  const stamps = JSON.stringify(L.doc).match(/"type":"stamp"/g) || [];
  ok(stamps.length === 2, 'repères audio dans les notes (début + Alt+M) : ' + stamps.length);
  await p.waitForFunction(() => { const a = document.querySelector('#recs audio'); return a && a.src; }, null, { timeout: 5000 });
  const dur = await p.$eval('#recs audio', (a) => new Promise((r) => { if (a.readyState >= 1) r(a.duration); else a.onloadedmetadata = () => r(a.duration); }));
  ok(dur > 4 && isFinite(dur), 'lecteur audio : durée ' + dur.toFixed(1) + ' s');
  await p.click('.ProseMirror .stamp >> nth=1');
  await p.waitForTimeout(500);
  const t = await p.$eval('#recs audio', (a) => ({ t: a.currentTime, paused: a.paused }));
  ok(!t.paused && t.t > 0.2, 'clic sur un repère : lecture à ' + t.t.toFixed(1) + ' s');
  await p.$eval('#recs audio', (a) => a.pause());
  await shot('09-audio');

  /* ---- persistance ---- */
  const id = L.id;
  await ev(() => Biji.store.flush());
  await p.reload();
  await p.waitForSelector('.ProseMirror');
  const after = await ev(() => Biji.editor.editor.getText());
  ok(after.includes('你好我是学生') && after.includes('le prof répète'), 'contenu conservé après rechargement' + (after.includes('le prof') ? '' : ' : ' + JSON.stringify(after.slice(-200))));
  ok((await p.$$('.ProseMirror table')).length === 1 && (await p.$$('.nv-ink')).length === 1 && (await p.$$('.stamp')).length === 2, 'tableau, dessin et repères conservés');
  ok(await ev((id) => location.hash === '#/c/' + id, id), 'même cours rouvert');

  /* ---- migration d'un cours V1 ---- */
  const v1id = await ev(() => Biji.store.create({ title: 'Ancien cours', doc: undefined, blocks: [
    { id: 'b1', type: 'text', text: '# Titre\n我们去银行[hang2]。\n- point un\n- point deux' },
    { id: 'b2', type: 'ink', h: 300, strokes: [{ k: 'pen', c: '#000', w: 2.6, p: [[10, 10, 0.5], [100, 100, 0.5]] }] },
    { id: 'b3', type: 'grid', chars: '我', reps: 4, cells: {} }] }).id);
  await p.goto(BASE + '?nosw#/c/' + v1id);
  await p.waitForSelector('.ProseMirror h1');
  const mig = await ev(() => ({ h1: document.querySelector('.ProseMirror h1').textContent, li: document.querySelectorAll('.ProseMirror li').length,
    ink: document.querySelectorAll('.nv-ink').length, grid: document.querySelectorAll('.nv-grid').length, fixed: document.querySelector('.hz.fixed') && document.querySelector('.hz.fixed').dataset.py }));
  ok(mig.h1 === 'Titre' && mig.li === 2 && mig.ink === 1 && mig.grid === 1 && mig.fixed === 'háng', 'migration V1 → V2 : ' + JSON.stringify(mig));
  await shot('10-migration');

  /* ---- révision + réglages ---- */
  await p.goto(BASE + '?nosw#/revision');
  await p.waitForSelector('.rcard');
  ok(true, 'page de révision');
  await p.goto(BASE + '?nosw#/reglages');
  await p.waitForSelector('.penzone');
  await shot('11-reglages');

  /* ---- mobile / étroit ---- */
  await p.setViewportSize({ width: 820, height: 1100 });
  await p.goto(BASE + '?nosw#/c/' + id);
  await p.waitForSelector('.ProseMirror');
  await p.waitForTimeout(400);
  await shot('12-etroit');

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await b.close();
  if (srv) srv.close();
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
