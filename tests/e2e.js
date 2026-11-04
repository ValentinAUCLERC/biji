// Test de bout en bout (headless) : node tests/e2e.js  — nécessite playwright-core + /usr/bin/chromium
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || '/tmp';
const URL = 'file://' + path.resolve(__dirname, '../site/index.html');

(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  const cdp = await ctx.newCDPSession(p);
  const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

  // tracé au « stylet » (CDP pointerType pen, avec pression)
  async function penStroke(pts) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1], pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
    for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.7 });
    const l = pts[pts.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  }
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

  await p.goto(URL);
  await p.waitForFunction(() => Biji.lex.ready, null, { timeout: 30000 });
  const t0 = await p.evaluate(() => performance.now());
  console.log('dictionnaire chargé à', Math.round(t0), 'ms (cumul page)');
  await p.screenshot({ path: OUT + '/01-accueil.png' });

  // nouveau cours + saisie
  await p.click('text=+ Nouveau cours');
  await p.waitForFunction(() => document.activeElement && document.activeElement.matches('textarea.zh-edit'));
  await p.keyboard.type('# 第一课 Leçon 1\n你好！我是学生。\n- ni3 hao3 = bonjour\n- 我们去银行。他走了。');
  const val = await p.$eval('textarea.zh-edit', (t) => t.value);
  ok(val.includes('nǐ hǎo'), 'conversion ni3 hao3 -> nǐ hǎo : ' + JSON.stringify(val.split('\n')[2]));
  await p.click('.ltitle');
  await p.fill('.ltitle', 'Cours 1 · Salutations');
  await p.waitForSelector('.blk-text:not(.editing) .zh-view ruby');
  const rts = await p.$$eval('.zh-view ruby', (rs) => rs.map((r) => r.dataset.ch + (r.querySelector('rt').textContent)).join(' '));
  ok(/你nǐ 好hǎo/.test(rts), 'pinyin au-dessus des caractères : ' + rts.slice(0, 80));
  ok(/行háng/.test(rts), '银行 -> háng (polyphone en contexte)');
  ok(/了le/.test(rts), '了 -> le');
  const words = await p.$$eval('.zh-view .w', (ws) => ws.map((w) => w.dataset.w));
  ok(words.includes('你好') && words.includes('学生') && words.includes('银行'), 'segmentation en mots : ' + words.join('/'));

  // fiche d'un mot
  await p.click('.w[data-w="学生"]');
  await p.waitForSelector('#card:not([hidden]) .reading');
  const cardTxt = await p.$eval('#card', (c) => c.innerText);
  ok(/étudiant/.test(cardTxt), 'fiche 学生 en français');
  await p.waitForSelector('#card .hw svg', { timeout: 5000 }).catch(() => {});
  ok(!!(await p.$('#card .hw svg')), 'Hanzi Writer affiché (données de traits en file://)');
  await p.click('#card .ctx button.primary');
  await p.screenshot({ path: OUT + '/02-fiche.png' });

  // correction de pinyin sur 行 (via la fiche de 银行)
  await p.click('#card .cbtns .icon');
  await p.click('.w[data-w="银行"]');
  await p.waitForSelector('#card .fix select');
  const sels = await p.$$('#card .fix select');
  await sels[sels.length - 1].selectOption('xíng');
  await p.waitForTimeout(200);
  const txt2 = await p.evaluate(() => Biji.editor.lesson.blocks[0].text);
  ok(txt2.includes('行[xíng]'), 'correction de pinyin écrite dans le texte : ' + txt2.split('\n')[3]);
  const rt2 = await p.$$eval('.zh-view ruby.fixed', (rs) => rs.map((r) => r.dataset.ch + r.querySelector('rt').textContent));
  ok(rt2.includes('行xíng'), 'lecture corrigée affichée');
  await sels[sels.length - 1].selectOption('');
  await p.click('#card .cbtns .icon');

  // pavé d'écriture : tracer 十 au stylet puis insérer le candidat
  await p.click('.zh-view');
  await p.keyboard.press('Control+End');
  await p.keyboard.type('\n手写：');
  await p.click('button[data-act="pad"]');
  await p.waitForSelector('#pad:not([hidden])');
  const bx = await p.$eval('#padcanvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const P = (u, v) => [bx.x + (u / 100) * bx.w, bx.y + (v / 100) * bx.w];
  await penStroke(line(...P(15, 45), ...P(85, 45)));
  await penStroke(line(...P(50, 10), ...P(50, 92)));
  await p.waitForFunction(() => [...document.querySelectorAll('.cand .ch')].some((c) => c.textContent === '十'), null, { timeout: 10000 }).catch(() => {});
  const cands = await p.$$eval('.cand .ch', (c) => c.map((x) => x.textContent));
  ok(cands.slice(0, 3).includes('十'), 'reconnaissance de 十 : ' + cands.join(''));
  await p.screenshot({ path: OUT + '/03-pave.png' });
  await p.click('.cand:has-text("十")');
  const txt3 = await p.evaluate(() => Biji.editor.lesson.blocks[0].text);
  ok(txt3.endsWith('手写：十'), 'candidat inséré au curseur : ' + JSON.stringify(txt3.slice(-6)));
  await p.click('button[data-act="pad"]');

  // bloc dessin : un trait au stylet, puis gomme
  await p.click('text=+ Dessin libre');
  await p.waitForSelector('.inkc');
  const ib = await p.$eval('.inkc', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await penStroke(line(ib.x + 40, ib.y + 60, ib.x + 300, ib.y + 140, 30));
  await penStroke(line(ib.x + 60, ib.y + 200, ib.x + 260, ib.y + 220, 20));
  let n = await p.evaluate(() => Biji.editor.lesson.blocks.find((b) => b.type === 'ink').strokes.length);
  ok(n === 2, 'deux traits enregistrés dans le bloc dessin (' + n + ')');
  ok(await p.evaluate(() => Biji.editor.lesson.blocks.find((b) => b.type === 'ink').strokes[0].p.some((q) => q[2] > 0.5)), 'pression du stylet enregistrée');
  await p.click('.tool[title^="Gomme"]');
  await penStroke(line(ib.x + 150, ib.y + 190, ib.x + 160, ib.y + 230, 6));
  n = await p.evaluate(() => Biji.editor.lesson.blocks.find((b) => b.type === 'ink').strokes.length);
  ok(n === 1, 'gomme : un trait effacé (' + n + ' restant)');
  await p.click('#toolbar .icon[title^="Annuler"]');
  n = await p.evaluate(() => Biji.editor.lesson.blocks.find((b) => b.type === 'ink').strokes.length);
  ok(n === 2, 'annuler restaure le trait (' + n + ')');
  await p.click('.tool[title="Stylo noir"]');

  // bloc cases 田
  await p.click('text=+ Cases 田');
  await p.fill('.gridchars', '你好');
  await p.waitForTimeout(700);
  const rows = await p.$$eval('.gridrow', (r) => r.length);
  ok(rows === 2, 'cases 田 : une ligne par caractère (' + rows + ')');
  const cb = await p.$eval('.gridrow .cellwrap:nth-child(3) canvas', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  await penStroke(line(cb.x + 10, cb.y + 30, cb.x + 50, cb.y + 30));
  ok(await p.evaluate(() => Biji.editor.lesson.blocks.find((b) => b.type === 'grid').cells['你:1'].length === 1), 'tracé dans une case enregistré');
  await p.waitForTimeout(800);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: OUT + '/04-cours.png', fullPage: true });

  // vocabulaire repéré + ajout
  await p.waitForSelector('#vocab .chip');
  await p.click('#vocab .chip:has-text("你好")');
  const voc = await p.evaluate(() => Biji.editor.lesson.vocab.map((v) => v.hz + '|' + v.py + '|' + v.fr));
  ok(voc.length === 2, 'vocabulaire : ' + voc.join(' ; '));

  // persistance (IndexedDB) après rechargement
  await p.evaluate(() => Biji.store.flush());
  await p.reload();
  await p.waitForSelector('#lessons a');
  await p.click('#lessons a');
  await p.waitForSelector('.zh-view ruby');
  const persisted = await p.evaluate(() => ({ blocks: Biji.editor.lesson.blocks.length, vocab: Biji.editor.lesson.vocab.length, title: Biji.editor.lesson.title }));
  ok(persisted.blocks === 3 && persisted.vocab === 2, 'rechargement : ' + JSON.stringify(persisted));

  // révision : lire puis écrire
  await p.goto(URL + '#/revision');
  await p.waitForSelector('.rcard');
  await p.click('text=Voir la réponse');
  await p.waitForSelector('.ans');
  await p.screenshot({ path: OUT + '/05-revision-lire.png' });
  await p.click('text=Je savais');
  await p.click('.tabs button:has-text("Écrire")');
  await p.waitForSelector('.hwbig svg', { timeout: 5000 });
  await p.screenshot({ path: OUT + '/06-revision-ecrire.png' });

  // réglages
  await p.goto(URL + '#/reglages');
  await p.waitForSelector('.settings');
  await p.screenshot({ path: OUT + '/07-reglages.png', fullPage: true });

  // mobile / tablette portrait
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(URL);
  await p.waitForSelector('#lessons a', { state: 'attached' });
  await p.evaluate(() => (location.hash = '#/c/' + Biji.store.list()[0].id));
  await p.waitForSelector('.zh-view ruby');
  await p.screenshot({ path: OUT + '/08-mobile.png', fullPage: true });

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
