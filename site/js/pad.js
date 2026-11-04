/* Biji — pavé d'écriture : on écrit un caractère au stylet, on choisit le bon candidat, il s'insère dans les notes */
(function () {
  const B = window.Biji;
  const pad = (B.pad = { open: false });
  let ink, strokes = [], matchers = null, el, cands;

  async function initRecognizer() {
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
  B.recognize = async function (strokeList, n = 10) {
    const ms = await initRecognizer();
    const input = strokeList.filter((s) => s.p.length).map((s) => s.p.map((q) => [q[0], q[1]]));
    if (!input.length) return [];
    const ac = new window.HanziLookup.AnalyzedCharacter(input);
    const lists = await Promise.all(ms.map((m) => new Promise((res) => m.match(ac, n, res))));
    const out = [];
    for (let i = 0; i < n && out.length < n; i++) {
      for (const l of lists) {
        const c = l[i] && l[i].character;
        if (c && !out.includes(c)) out.push(c);
      }
    }
    return out.slice(0, n);
  };

  function build() {
    el = B.h('section#pad', { 'aria-label': 'Écriture manuscrite', hidden: true },
      B.h('header',
        B.h('strong', '手写 '), B.h('span.sub', 'Écrire un caractère'),
        B.h('button.icon', { title: 'Fermer (Alt+H)', onclick: () => pad.toggle(false) }, '✕')),
      B.h('div.padbody',
        B.h('canvas#padcanvas'),
        B.h('div.padside',
          B.h('button', { title: 'Annuler le dernier trait', onclick: () => { ink.undo(); run(); } }, '↶'),
          B.h('button', { title: 'Effacer la case', onclick: () => { ink.clear(); run(); } }, '✕'),
          B.h('button', { title: 'Espace', onclick: () => B.insertText(' ') }, '␣'),
          B.h('button', { title: 'Supprimer le caractère avant le curseur', onclick: () => B.insertText(null, 1) }, '⌫'),
          B.h('button', { title: 'Retour à la ligne', onclick: () => B.insertText('\n') }, '↵'))),
      (cands = B.h('div.cands', B.h('span.hint', 'Les candidats apparaissent ici. Cliquer pour insérer.'))));
    document.body.appendChild(el);
    ink = new B.Ink(B.$('#padcanvas', el), {
      lw: 100, lh: () => 100, strokes, penScale: 1.2,
      fingerDraw: () => true,
      bg: (ctx, s, w, h) => B.bgTian(ctx, s, w, h),
      onChange: () => run(),
    });
  }

  const run = B.debounce(async () => {
    if (!strokes.length) {
      cands.replaceChildren(B.h('span.hint', 'Les candidats apparaissent ici. Cliquer pour insérer.'));
      return;
    }
    let list;
    try {
      list = await B.recognize(strokes, 10);
    } catch (e) {
      cands.replaceChildren(B.h('span.hint.err', 'Reconnaissance indisponible : ' + e.message));
      return;
    }
    cands.replaceChildren(...list.map((ch) =>
      B.h('button.cand', { lang: 'zh-CN', title: 'Insérer ' + ch, onclick: () => { B.insertText(ch); ink.clear(); strokes.length = 0; run(); } },
        B.h('span.ch', ch), B.h('span.py', (B.lex.pinyinRun(ch)[0] || '')))));
  }, 60);

  pad.toggle = function (force) {
    if (!el) build();
    pad.open = force == null ? !pad.open : force;
    el.hidden = !pad.open;
    document.body.classList.toggle('pad-open', pad.open);
    B.$$('[data-act="pad"]').forEach((b) => b.classList.toggle('on', pad.open));
    if (pad.open) { ink.resize(true); initRecognizer().catch((e) => B.toast(e.message)); }
  };
})();
