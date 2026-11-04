// Hors ligne + PWA (headless Chromium, service worker actif) : npm run build && node tests/offline.js
// Démarrage sans réseau dès la 1re visite, écriture hors ligne, état « Hors ligne », retour du réseau détecté, installabilité.
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'biji-offline');
fs.mkdirSync(OUT, { recursive: true });

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve(path.resolve(__dirname, '../site'));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'biji-prof-'));
  const ctx = await chromium.launchPersistentContext(prof, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], viewport: { width: 1366, height: 900 } });
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
  const p = ctx.pages()[0] || await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const ev = (f, a) => p.evaluate(f, a);

  /* ---- 1re visite : le service worker met en cache tout le nécessaire ---- */
  await p.goto(BASE);
  await p.waitForFunction(() => window.Biji && Biji.lex.ready, null, { timeout: 40000 });
  await ev(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  const cached = await p.waitForFunction(async () => {
    const keys = await caches.keys();
    const data = keys.find((k) => k.startsWith('biji-data-'));
    if (!data) return null;
    const c = await caches.open(data);
    const need = ['data/dict.js', 'data/hlookup.js', 'vendor/hanzilookup.min.js', 'vendor/pdfjs/pdf.min.mjs'];
    const have = await Promise.all(need.map((f) => c.match(f)));
    return have.every(Boolean) ? keys : null;
  }, null, { timeout: 30000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
  ok(!!cached, '1re visite : dictionnaire, reconnaissance et pdf.js en cache (' + (cached || []).join(', ') + ')');

  const cdp = await ctx.newCDPSession(p);
  const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ err: e.message }));
  ok(inst.installabilityErrors && inst.installabilityErrors.length === 0, 'PWA installable (manifeste, icônes, service worker) ' + JSON.stringify(inst.installabilityErrors || inst));
  const man = await cdp.send('Page.getAppManifest');
  ok(man.errors.length === 0 && /Bǐjì/.test(man.data), 'manifeste sans erreur');

  await p.click('#page button:has-text("+ Nouveau cours")');
  await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('ProseMirror'));
  await p.keyboard.type('Avant la coupure. ');
  await ev(() => Biji.store.flush());
  const lid = await ev(() => Biji.editor.lesson.id);

  /* ---- coupure réseau : l'appli redémarre et on écrit ---- */
  await ctx.setOffline(true);
  await p.waitForFunction(() => !Biji.net.online, null, { timeout: 8000 }).catch(() => {});
  ok(await ev(() => !Biji.net.online && getComputedStyle(document.querySelector('#netstate')).display !== 'none'), 'coupure détectée : badge « ⚠ Hors ligne » affiché');
  await p.reload();
  await p.waitForSelector('#side', { timeout: 15000 });
  ok(await ev(() => !!document.querySelector('#side .brand')), 'démarrage hors ligne : l’appli s’affiche');
  await p.waitForFunction(() => window.Biji && Biji.lex.ready, null, { timeout: 30000 }).catch(() => {});
  ok(await ev(() => Biji.lex.ready && Biji.lex.lookup && !!Biji.lex.lookup('你好')), 'démarrage hors ligne : dictionnaire disponible (你好)');
  ok(await ev((lid) => !!document.querySelector('#side a[href="#/c/' + lid + '"]'), lid), 'démarrage hors ligne : le cours est dans la liste');
  await p.goto(BASE + '#/c/' + lid);
  await p.waitForSelector('.ProseMirror');
  await p.waitForFunction(() => { const ed = Biji.editor.editor; if (!ed) return false; ed.commands.focus('end'); return document.activeElement && document.activeElement.classList.contains('ProseMirror'); });
  await p.keyboard.type('Écrit hors ligne 你好.');
  await ev(() => Biji.store.flush());
  ok(/hors ligne|navigateur/i.test(await p.$eval('#savestate', (e) => e.textContent)), 'écriture hors ligne : « ' + (await p.$eval('#savestate', (e) => e.textContent)) + ' »');
  await p.screenshot({ path: OUT + '/offline-01.png' });
  await p.reload();
  await p.waitForSelector('.ProseMirror', { timeout: 15000 });
  const t = await ev(() => Biji.editor.editor.getText());
  ok(t.includes('Avant la coupure') && t.includes('Écrit hors ligne 你好'), 'rechargé hors ligne : texte d’avant et d’après la coupure présents');
  ok(await ev(() => !Biji.net.online), 'toujours hors ligne après rechargement');

  /* ---- retour du réseau ---- */
  await ctx.setOffline(false);
  await p.waitForFunction(() => Biji.net.online, null, { timeout: 20000 }).catch(() => {});
  ok(await ev(() => Biji.net.online && getComputedStyle(document.querySelector('#netstate')).display === 'none'), 'retour du réseau détecté : badge masqué');

  /* ---- Wi-Fi « connecté » mais sans Internet : la vérification HEAD le voit ---- */
  await ctx.route('**/build.js?ping=*', (r) => r.abort('internetdisconnected'));
  ok((await ev(() => Biji.net.check())) === false && (await ev(() => !Biji.net.online)), 'réseau présent mais site injoignable : détecté hors ligne (vérification réelle)');
  await ctx.unroute('**/build.js?ping=*');
  ok((await ev(() => Biji.net.check())) === true, 'puis de nouveau joignable : en ligne');

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await ctx.close();
  srv.close();
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
