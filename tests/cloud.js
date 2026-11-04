// Synchro Google Drive entre deux appareils (PC + téléphone) contre un faux Drive local.
// npm run build && node tests/cloud.js
// Le faux serveur imite l'API REST Drive v3 utilisée par src/gdrive.js ; la connexion Google (GIS) est simulée.
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright-core');
const OUT = process.env.OUT || '/tmp/biji-shots';
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, '../site');

/* ---------------- faux Google Drive ---------------- */
const files = new Map();
const sessions = new Map();
const revoked = new Set();
let seq = 0;
const newId = () => 'f' + ++seq;
const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties || {}, trashed: !!f.trashed, size: String(f.content ? f.content.length : 0) });
function matches(f, q) {
  return q.split(' and ').every((c) => {
    c = c.trim();
    let m;
    if ((m = /^name='(.*)'$/.exec(c))) return f.name === m[1].replace(/\\'/g, "'");
    if ((m = /^mimeType='(.*)'$/.exec(c))) return f.mimeType === m[1];
    if ((m = /^mimeType!='(.*)'$/.exec(c))) return f.mimeType !== m[1];
    if (c === 'trashed=false') return !f.trashed;
    if ((m = /^'(.*)' in parents$/.exec(c))) return (f.parents || []).includes(m[1]);
    throw new Error('requête non gérée : ' + c);
  });
}
function parseMultipart(buf, ct) {
  const b = /boundary=(.+)$/.exec(ct)[1];
  const s = buf.toString('latin1');
  const parts = s.split('--' + b).slice(1, -1).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, -2));
  return { meta: JSON.parse(Buffer.from(parts[0], 'latin1').toString('utf8')), content: Buffer.from(parts[1], 'latin1') };
}
const stats = { multipart: 0, resumable: 0, downloads: 0 };
function drive(req, res, body, url) {
  const send = (code, obj, headers = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(obj == null ? '' : JSON.stringify(obj)); };
  const auth = req.headers.authorization || '';
  // l'URL de session d'upload reprenable vaut autorisation (comme chez Google)
  if (!url.pathname.startsWith('/gapi/upload/session/') && (!/^Bearer tok-/.test(auth) || revoked.has(auth.slice(7)))) return send(401, { error: { code: 401, message: 'Invalid Credentials' } });
  const p = url.pathname.replace(/^\/gapi/, '');
  let m;
  if (p === '/drive/v3/about') return send(200, { user: { emailAddress: 'valentin@example.com', displayName: 'Valentin' } });
  if (p === '/drive/v3/files' && req.method === 'GET') {
    const q = url.searchParams.get('q');
    return send(200, { files: [...files.values()].filter((f) => matches(f, q)).map(meta) });
  }
  if (p === '/drive/v3/files' && req.method === 'POST') {
    const j = JSON.parse(body.toString());
    const f = Object.assign({ id: newId() }, j);
    files.set(f.id, f);
    return send(200, { id: f.id });
  }
  if ((m = /^\/drive\/v3\/files\/(\w+)$/.exec(p))) {
    const f = files.get(m[1]);
    if (!f) return send(404, { error: { code: 404, message: 'File not found' } });
    if (req.method === 'PATCH') { Object.assign(f, JSON.parse(body.toString())); return send(200, { id: f.id }); }
    if (url.searchParams.get('alt') === 'media') { stats.downloads++; res.writeHead(200, { 'Content-Type': f.mimeType || 'application/octet-stream' }); return res.end(f.content); }
    return send(200, meta(f));
  }
  if (p === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
    stats.multipart++;
    const { meta: mt, content } = parseMultipart(body, req.headers['content-type']);
    const f = Object.assign({ id: newId() }, mt, { content });
    files.set(f.id, f);
    return send(200, { id: f.id });
  }
  if ((m = /^\/upload\/drive\/v3\/files\/(\w+)$/.exec(p)) && req.method === 'PATCH') {
    stats.multipart++;
    const f = files.get(m[1]);
    const { meta: mt, content } = parseMultipart(body, req.headers['content-type']);
    Object.assign(f, mt, { content });
    return send(200, { id: f.id });
  }
  if (p === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
    stats.resumable++;
    const sid = 's' + ++seq;
    sessions.set(sid, JSON.parse(body.toString()));
    return send(200, null, { Location: `http://${req.headers.host}/gapi/upload/session/${sid}` });
  }
  if ((m = /^\/upload\/session\/(\w+)$/.exec(p)) && req.method === 'PUT') {
    const f = Object.assign({ id: newId() }, sessions.get(m[1]), { content: body });
    files.set(f.id, f);
    return send(200, { id: f.id, name: f.name });
  }
  send(400, { error: { message: 'non géré : ' + req.method + ' ' + p } });
}
function server() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/gapi/')) return drive(req, res, Buffer.concat(chunks), url);
      let f = path.join(ROOT, decodeURIComponent(url.pathname));
      if (f.endsWith('/')) f += 'index.html';
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
        res.end(data);
      });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ---------------- connexion Google simulée ---------------- */
const GIS_STUB = () => {
  window.BIJI_CONFIG = { googleClientId: 'test.apps.googleusercontent.com', driveApi: location.origin + '/gapi' };
  window.__gis = [];
  window.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({ requestAccessToken: (o) => { window.__gis.push(o || {}); setTimeout(() => cfg.callback({ access_token: 'tok-' + Math.random().toString(36).slice(2), expires_in: 3599, scope: cfg.scope }), 20); } }),
    hasGrantedAllScopes: () => true,
    revoke: (t, cb) => cb && cb({ successful: true }),
  } } };
};

(async () => {
  const srv = await server();
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
  const errs = [];
  async function device(opts) {
    const ctx = await b.newContext(Object.assign({ permissions: ['microphone'] }, opts));
    await ctx.addInitScript(GIS_STUB);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errs.push('console: ' + m.text()));
    await p.goto(BASE + '?nosw');
    await p.waitForFunction(() => window.Biji && Biji.lex.ready, null, { timeout: 40000 });
    return p;
  }
  const driveFiles = () => [...files.values()].filter((f) => !f.trashed);
  const text = (p) => p.evaluate(() => Biji.editor.editor && Biji.editor.editor.getText());

  /* ---- PC : un cours + un enregistrement, avant toute connexion ---- */
  const pc = await device({ viewport: { width: 1366, height: 900 } });
  await pc.click('text=+ Nouveau cours');
  await pc.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('ProseMirror'));
  await pc.keyboard.type('Cours sur Drive ');
  await pc.evaluate(() => Biji.editor.editor.commands.insertContent('你好'));
  await pc.click('[data-act="rec"]');
  await pc.waitForFunction(() => Biji.rec.state === 'rec', null, { timeout: 8000 });
  await pc.waitForTimeout(3200);
  pc.once('dialog', (d) => d.accept());
  await pc.click('[data-act="rec"]');
  await pc.waitForFunction(() => Biji.rec.state === 'idle' && Biji.editor.lesson.recordings.length === 1, null, { timeout: 10000 });
  const lessonId = await pc.evaluate(() => Biji.editor.lesson.id);
  await pc.evaluate(() => Biji.store.flush());

  /* ---- PC : connexion Google depuis les réglages ---- */
  await pc.goto(BASE + '?nosw#/reglages');
  await pc.click('button:has-text("Se connecter avec Google")');
  await pc.waitForFunction(() => Biji.gdrive.state === 'on' && Biji.store.lastSync, null, { timeout: 10000 });
  ok((await pc.evaluate(() => window.__gis[0].prompt)) === 'select_account', 'première connexion : choix du compte Google');
  await pc.waitForFunction(() => !Biji.gdrive.progress, null, { timeout: 10000 });
  await pc.waitForTimeout(300);
  const names = driveFiles().map((f) => f.name);
  const lf = driveFiles().find((f) => f.name === lessonId + '.json');
  ok(names.includes('Biji') && names.includes('audio'), 'dossiers « Biji » et « audio » créés dans le Drive');
  ok(lf && +lf.appProperties.u > 0 && JSON.parse(lf.content.toString()).title === 'Cours 1', 'cours envoyé (' + (lf && lf.name) + ', updatedAt dans appProperties)');
  const af = driveFiles().find((f) => f.mimeType && f.mimeType.startsWith('audio/'));
  ok(af && af.content.length > 1000 && stats.resumable === 1, 'enregistrement envoyé en upload reprenable (' + (af ? af.content.length : 0) + ' octets)');
  ok(await pc.$eval('#side #dirstate', (e) => e.textContent.includes('valentin@example.com')), 'barre latérale : ☁ Google Drive : valentin@example.com');
  await pc.screenshot({ path: OUT + '/cloud-01-reglages.png' });

  /* ---- Téléphone : connexion -> le cours et l'audio arrivent ---- */
  const phone = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok((await phone.evaluate(() => Biji.store.list().length)) === 0, 'téléphone : aucun cours avant connexion');
  await phone.screenshot({ path: OUT + '/cloud-02-tel-accueil.png' });
  await phone.click('.notice button:has-text("Se connecter avec Google")');
  await phone.waitForFunction(() => Biji.store.list().length === 1, null, { timeout: 10000 });
  ok(true, 'téléphone : le cours du PC est arrivé');
  await phone.goto(BASE + '?nosw#/c/' + lessonId);
  await phone.waitForSelector('.ProseMirror');
  ok((await text(phone)).includes('你好'), 'téléphone : contenu du cours (' + JSON.stringify((await text(phone)).slice(0, 40)) + ')');
  await phone.waitForFunction(() => { const a = document.querySelector('#recs audio'); return a && a.src; }, null, { timeout: 10000 });
  const dur = await phone.$eval('#recs audio', (a) => new Promise((r) => { if (a.readyState >= 1) r(a.duration); else a.onloadedmetadata = () => r(a.duration); }));
  ok(dur > 2 && stats.downloads >= 2, 'téléphone : audio téléchargé depuis Drive et lisible (' + dur.toFixed(1) + ' s)');
  await phone.screenshot({ path: OUT + '/cloud-03-tel-cours.png' });

  /* ---- modification sur le téléphone -> PC ---- */
  await phone.evaluate(() => Biji.editor.editor.chain().focus('end').insertContent(' écrit sur le téléphone').run());
  await phone.evaluate(() => Biji.store.flush());
  ok(JSON.parse(driveFiles().find((f) => f.name === lessonId + '.json').content.toString()).doc && (await text(phone)).includes('téléphone'), 'téléphone : modification envoyée');
  await pc.goto(BASE + '?nosw#/c/' + lessonId);
  await pc.waitForSelector('.ProseMirror');
  await pc.evaluate(() => Biji.store.syncAll());
  await pc.waitForFunction(() => Biji.editor.editor && Biji.editor.editor.getText().includes('téléphone'), null, { timeout: 5000 }).catch(() => {});
  ok((await text(pc)).includes('écrit sur le téléphone'), 'PC : la modification du téléphone apparaît');

  /* ---- cours ouvert et en cours d'édition sur le PC : pas d'écrasement silencieux ---- */
  await pc.evaluate(() => Biji.editor.editor.commands.focus('end'));
  await phone.evaluate(() => Biji.editor.editor.chain().insertContentAt(Biji.editor.editor.state.doc.content.size, '<p>2e ajout</p>').run());
  await phone.evaluate(() => Biji.store.flush());
  await pc.evaluate(() => Biji.store.syncAll());
  await pc.waitForSelector('#newer', { timeout: 5000 });
  ok(true, 'PC en train d’écrire : bandeau « modifié sur un autre appareil »');
  await pc.screenshot({ path: OUT + '/cloud-04-conflit.png' });
  await pc.click('#newer button:has-text("Afficher cette version")');
  await pc.waitForFunction(() => Biji.editor.editor && Biji.editor.editor.getText().includes('2e ajout'), null, { timeout: 5000 }).catch(() => {});
  ok((await text(pc)).includes('2e ajout'), 'PC : version reçue affichée');

  /* ---- nouveau cours sur le téléphone, suppression sur le PC ---- */
  const id2 = await phone.evaluate(() => Biji.store.create({ title: 'Cours du téléphone', doc: { type: 'doc', content: [{ type: 'paragraph' }] } }).id);
  await phone.evaluate(() => Biji.store.flush());
  await pc.evaluate(() => Biji.store.syncAll());
  ok(await pc.evaluate((id) => !!Biji.store.get(id), id2), 'PC : cours créé sur le téléphone reçu');
  await pc.evaluate((id) => { Biji.store.remove(id); return Biji.store.flush(); }, id2);
  await phone.evaluate(() => Biji.store.syncAll());
  ok(await phone.evaluate((id) => !Biji.store.get(id), id2), 'téléphone : cours supprimé sur le PC disparu');

  /* ---- jeton expiré (1 h) : bouton « Reconnecter », rien de perdu ---- */
  await pc.evaluate(() => { const t = JSON.parse(localStorage.getItem('biji.gtoken')); t.exp = Date.now() - 1000; localStorage.setItem('biji.gtoken', JSON.stringify(t)); });
  await pc.reload();
  await pc.waitForFunction(() => window.Biji && Biji.gdrive.state === 'expired', null, { timeout: 10000 });
  await pc.waitForSelector('#cloud button:has-text("Reconnecter")');
  await pc.evaluate(() => Biji.editor.editor.chain().focus('end').insertContent('<p>hors connexion</p>').run());
  await pc.evaluate(() => Biji.store.flush());
  ok(await pc.evaluate(() => Biji.editor.lesson.updatedAt > 0) && !JSON.parse(driveFiles().find((f) => f.name === lessonId + '.json').content.toString()).doc.content.some((n) => JSON.stringify(n).includes('hors connexion')), 'jeton expiré : modification gardée dans le navigateur, pas envoyée');
  await pc.screenshot({ path: OUT + '/cloud-05-expire.png' });
  const before = await pc.evaluate(() => window.__gis.length);
  await pc.click('#side a:has-text("Réviser le vocabulaire")'); // premier clic après ouverture -> reconnexion
  await pc.waitForFunction(() => Biji.gdrive.state === 'on', null, { timeout: 5000 });
  const last = await pc.evaluate(() => window.__gis[window.__gis.length - 1]);
  ok((await pc.evaluate(() => window.__gis.length)) === before + 1 && last.prompt === '' && last.login_hint === 'valentin@example.com', 'premier clic : reconnexion sans re-choisir le compte');
  await pc.waitForTimeout(500);
  ok(JSON.stringify(JSON.parse(driveFiles().find((f) => f.name === lessonId + '.json').content.toString())).includes('hors connexion'), 'après reconnexion : la modification part sur Drive');

  /* ---- jeton révoqué côté Google (401) ---- */
  const tok = await phone.evaluate(() => JSON.parse(localStorage.getItem('biji.gtoken')).t);
  revoked.add(tok);
  await phone.evaluate(() => Biji.store.syncAll());
  ok((await phone.evaluate(() => Biji.gdrive.state)) === 'expired', 'jeton refusé (401) : état « Reconnecter »');
  await phone.click('#cloud button');
  await phone.waitForFunction(() => Biji.gdrive.state === 'on', null, { timeout: 5000 });
  ok(true, 'téléphone : « ☁ Reconnecter » rétablit la synchro');
  await phone.screenshot({ path: OUT + '/cloud-06-tel-final.png' });

  /* ---- déconnexion ---- */
  await phone.goto(BASE + '?nosw#/reglages');
  phone.once('dialog', (d) => d.accept());
  await phone.click('button:has-text("Déconnecter cet appareil")');
  ok((await phone.evaluate(() => [Biji.gdrive.state, localStorage.getItem('biji.gtoken')])).join() === 'off,', 'déconnexion : jeton oublié');
  ok((await phone.evaluate(() => Biji.store.list().length)) === 1, 'déconnexion : les cours restent sur l’appareil');

  ok(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  console.log('requêtes Drive : ' + JSON.stringify(stats));
  await b.close();
  srv.close();
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
