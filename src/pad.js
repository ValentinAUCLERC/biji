/* Biji — pavé d'écriture manuscrite
 * On écrit un ou plusieurs caractères (3 cases), on choisit le candidat, il s'insère dans les notes.
 * Reconnaissance : Google Input Tools quand on est en ligne (bien plus fiable, lit des mots entiers),
 * sinon HanziLookupJS hors ligne, case par case.
 */
(function () {
  const B = window.Biji;
  const pad = (B.pad = { open: false });
  const CELLS = 3;
  const LW = 100 * CELLS, LH = 100;
  let ink, el, cands, src;
  const strokes = [];
  let reqId = 0;

  /* ---------- reconnaissance hors ligne (HanziLookupJS) ---------- */
  let matchers = null;
  async function initLocal() {
    if (matchers) return matchers;
    await B.loadScript('vendor/hanzilookup.min.js');
    await B.loadScript('data/hlookup.js');
    const HL = window.HanziLookup;
    for (const [name, raw] of [['mmah', window.BIJI_HL_MMAH], ['orig', window.BIJI_HL_ORIG]]) {
      HL.data[name] = { chars: raw.chars, substrokes: HL.decodeCompact(raw.substrokes) };
    }
    window.BIJI_HL_MMAH = window.BIJI_HL_ORIG = null;
    matchers = [new HL.Matcher('mmah'), new HL.Matcher('orig')];
    return matchers;
  }
  /** Un caractère : strokes [{p:[[x,y]…]}] -> ['你', …] */
  async function localChar(list, n) {
    const ms = await initLocal();
    const input = list.filter((s) => s.p.length).map((s) => s.p.map((q) => [q[0], q[1]]));
    if (!input.length) return [];
    const ac = new window.HanziLookup.AnalyzedCharacter(input);
    const lists = await Promise.all(ms.map((m) => new Promise((res) => m.match(ac, n, res))));
    const out = [];
    for (let i = 0; i < n; i++) for (const l of lists) {
      const c = l[i] && l[i].character;
      if (c && !out.includes(c)) out.push(c);
    }
    return out.slice(0, n);
  }
  /** Hors ligne : on regroupe les traits par case, une reconnaissance par case */
  async function recognizeLocal(list, cellW) {
    const groups = [];
    for (const s of list) {
      const xs = s.p.map((q) => q[0]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const g = Math.max(0, Math.min(CELLS - 1, Math.floor(cx / cellW)));
      (groups[g] = groups[g] || []).push(s);
    }
    const per = [];
    for (const g of groups) if (g) per.push(await localChar(g, 8));
    if (!per.length) return [];
    if (per.length === 1) return per[0];
    // plusieurs cases : 1ers choix combinés, puis variantes sur la dernière case
    const top = per.map((c) => c[0] || '').join('');
    const out = [top];
    const head = per.slice(0, -1).map((c) => c[0] || '').join('');
    per[per.length - 1].slice(1, 6).forEach((c) => out.push(head + c));
    return out;
  }

  /* ---------- reconnaissance en ligne (Google Input Tools) ---------- */
  async function recognizeGoogle(list, w, h) {
    let t = 0;
    const inkData = list.filter((s) => s.p.length).map((s) => {
      const xs = [], ys = [], ts = [];
      for (const q of s.p) { xs.push(Math.round(q[0] * 10) / 10); ys.push(Math.round(q[1] * 10) / 10); ts.push((t += 12)); }
      t += 250;
      return [xs, ys, ts];
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    try {
      const r = await fetch('https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: w, writing_area_height: h }, ink: inkData, language: 'zh_CN' }] }),
        signal: ctl.signal,
      });
      const j = await r.json();
      if (j[0] !== 'SUCCESS') throw new Error('réponse inattendue');
      return (j[1][0][1] || []).map((s) => s.replace(/\s+/g, '')).filter((s) => B.HAN.test(s));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reconnaissance : en ligne si permis, sinon (ou en cas d'échec) hors ligne. Renvoie {list, source} */
  B.recognize = async function (list, opts = {}) {
    const w = opts.w || LW, h = opts.h || LH;
    if (B.settings.onlineHw !== false && navigator.onLine !== false && !opts.offline) {
      try {
        const g = await recognizeGoogle(list, w, h);
        if (g.length) return { list: g.slice(0, 12), source: 'google' };
      } catch (e) { /* hors ligne / bloqué : on retombe sur le moteur local */ }
    }
    return { list: await recognizeLocal(list, opts.cellW || 100), source: 'local' };
  };

  /* ---------- interface ---------- */
  function build() {
    el = B.h('section#pad', { 'aria-label': 'Écriture manuscrite', hidden: true },
      B.h('header',
        B.h('strong', { lang: 'zh-CN' }, '手写 '), B.h('span.sub', 'Écrire un mot (1 à 3 caractères), puis choisir'),
        (src = B.h('span.src')),
        B.h('button.icon', { title: 'Fermer (Alt+H)', onclick: () => pad.toggle(false) }, '✕')),
      B.h('div.padbody',
        B.h('canvas#padcanvas'),
        B.h('div.padside',
          B.h('button', { title: 'Annuler le dernier trait', onclick: () => { ink.undo(); } }, '↶'),
          B.h('button', { title: 'Tout effacer', onclick: () => { ink.clear(); } }, '✕'),
          B.h('button', { title: 'Espace', onclick: () => B.insertText(' ') }, '␣'),
          B.h('button', { title: 'Effacer le caractère avant le curseur', onclick: () => B.insertText(null, 1) }, '⌫'),
          B.h('button', { title: 'Nouvelle ligne', onclick: () => B.insertText('\n') }, '↵'))),
      (cands = B.h('div.cands', B.h('span.hint', 'Écrire dans les cases : les candidats apparaissent ici.'))));
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('canvas')) e.preventDefault(); }); // ne pas voler le focus de l'éditeur
    document.body.appendChild(el);
    ink = new B.Ink(B.$('#padcanvas', el), {
      lw: LW, lh: () => LH, strokes, penScale: 1.25,
      fingerDraw: () => true,
      bg: (ctx, s, w, h) => {
        for (let i = 0; i < CELLS; i++) {
          ctx.save();
          ctx.translate((i * w) / CELLS, 0);
          B.bgTian(ctx, s, w / CELLS, h);
          ctx.restore();
        }
      },
      onChange: () => run(),
    });
  }

  function insert(text) {
    B.insertText(text);
    ink.clear();
    strokes.length = 0;
    ink.hist.length = 0;
    show([]);
  }
  function show(list, source) {
    if (!strokes.length) {
      cands.replaceChildren(B.h('span.hint', 'Écrire dans les cases : les candidats apparaissent ici.'));
      src.textContent = '';
      return;
    }
    src.textContent = source === 'google' ? 'en ligne' : source === 'local' ? 'hors ligne' : '';
    src.title = source === 'google' ? 'Reconnaissance Google (réglable dans Réglages)' : 'Reconnaissance locale, moins précise : écrire un caractère par case, dans l’ordre des traits';
    if (!list.length) { cands.replaceChildren(B.h('span.hint', 'Rien de reconnu, continuer à écrire…')); return; }
    cands.replaceChildren(...list.map((w, i) => {
      const py = B.lex.pinyinRun(w).join(' ');
      return B.h('button.cand', { lang: 'zh-CN', class: i === 0 ? 'first' : null, title: 'Insérer ' + w, onclick: () => insert(w) },
        B.h('span.ch', w), B.h('span.py', py), B.lex.ready ? B.h('span.gl', B.lex.shortGloss(w)) : null);
    }));
  }
  const run = B.debounce(async () => {
    const id = ++reqId;
    if (!strokes.length) return show([]);
    try {
      const r = await B.recognize(strokes.slice(), { w: LW, h: LH, cellW: 100 });
      if (id === reqId) show(r.list, r.source);
    } catch (e) {
      cands.replaceChildren(B.h('span.hint.err', 'Reconnaissance indisponible : ' + e.message));
    }
  }, 250);

  pad.toggle = function (force) {
    if (!el) build();
    pad.open = force == null ? !pad.open : !!force;
    el.hidden = !pad.open;
    document.body.classList.toggle('pad-open', pad.open);
    B.$$('[data-act="pad"]').forEach((b) => b.classList.toggle('on', pad.open));
    if (pad.open) {
      ink.resize(true);
      if (B.settings.onlineHw === false || !navigator.onLine) initLocal().catch((e) => B.toast(e.message));
    }
  };
  /** Espace / Entrée au clavier pendant que le pavé a des candidats : prendre le premier */
  pad.takeFirst = function () {
    const b = el && !el.hidden && B.$('.cand.first', el);
    if (b) { b.click(); return true; }
    return false;
  };
})();
