/* Biji — saisie pinyin -> hanzi (IME intégré)
 * Taper « nihao » propose 你好 (avec le sens en français sous chaque candidat).
 * Espace = 1er candidat, 1-9 = choix, Entrée = garder les lettres, Échap = annuler, Maj seule = basculer 中/FR.
 */
(function () {
  const B = window.Biji;
  const SYL = new Set((window.BIJI_SYL || '').split(' ').filter(Boolean));
  const PREFIX = new Map(); // préfixe -> syllabes complètes qui commencent ainsi
  for (const s of SYL) for (let i = 1; i <= s.length; i++) {
    const p = s.slice(0, i);
    if (!PREFIX.has(p)) PREFIX.set(p, []);
    PREFIX.get(p).push(s);
  }
  const PUNCT = { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；', '(': '（', ')': '）', '\\': '、', '<': '《', '>': '》', '[': '【', ']': '】', '~': '～' };
  const PER_PAGE = 6;
  const PARTICLES = new Set(['吗', '呢', '吧', '啊', '了', '呀', '嘛']);

  const I = (B.ime = { on: false, buf: '', cands: [], page: 0, sel: 0, adapter: null });
  const picks = JSON.parse(localStorage.getItem('biji.imePicks') || '{}');
  const savePicks = B.debounce(() => localStorage.setItem('biji.imePicks', JSON.stringify(picks)), 1000);

  /* ---------------- moteur ---------------- */
  const logp = (f) => (f ? f / 10 - 9 : -8.5);
  const bonus = (w) => Math.min(picks[w] || 0, 6) * 0.5;

  /** Découpe « nihaom » en syllabes ; la dernière peut être partielle. Renvoie au plus 3 découpages minimaux. */
  function segmentations(letters) {
    const n = letters.length;
    const res = [];
    // dp[i] = liste de découpages complets de letters[0..i) avec nombre minimal de syllabes
    const dp = Array.from({ length: n + 1 }, () => null);
    dp[0] = [[]];
    for (let i = 0; i < n; i++) {
      if (!dp[i]) continue;
      for (let L = 1; L <= 6 && i + L <= n; L++) {
        const s = letters.slice(i, i + L);
        if (!SYL.has(s)) continue;
        const cand = dp[i].map((seg) => seg.concat([{ s, a: i, b: i + L }]));
        const cur = dp[i + L];
        if (!cur || cand[0].length < cur[0].length) dp[i + L] = cand.slice(0, 3);
        else if (cand[0].length === cur[0].length) dp[i + L] = cur.concat(cand).slice(0, 3);
      }
    }
    if (dp[n]) res.push(...dp[n]);
    // dernière syllabe partielle
    for (let j = n - 1; j >= 0 && j >= n - 5; j--) {
      if (!dp[j]) continue;
      const p = letters.slice(j);
      if (SYL.has(p) || !PREFIX.has(p)) continue;
      for (const seg of dp[j]) res.push(seg.concat([{ s: p, a: j, b: n, partial: true }]));
      break;
    }
    if (!res.length) return [];
    const min = Math.min(...res.map((r) => r.length + (r[r.length - 1].partial ? 0.5 : 0)));
    return res.filter((r) => r.length + (r[r.length - 1].partial ? 0.5 : 0) <= min + 0.01).slice(0, 3);
  }

  /** Mots dont les syllabes valent exactement seq (la dernière peut être un préfixe) */
  function wordsFor(seq) {
    const last = seq[seq.length - 1];
    const head = seq.slice(0, -1).map((x) => x.s);
    const lasts = last.partial ? (PREFIX.get(last.s) || []).slice(0, 40) : [last.s];
    const out = [];
    for (const l of lasts) {
      const a = B.lex.bySyl.get(head.concat([l]).join(' '));
      if (a) out.push(...a);
    }
    return out;
  }

  /** Meilleure phrase (programmation dynamique sur les mots du dictionnaire) */
  function sentence(seq) {
    const n = seq.length;
    const best = Array(n + 1).fill(null);
    best[0] = { score: 0, words: [] };
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (let L = 1; L <= Math.min(6, n - i); L++) {
        const a = wordsFor(seq.slice(i, i + L));
        if (!a.length) continue;
        const top = a.reduce((m, x) => (x.f + bonus(x.w) * 10 > m.f + bonus(m.w) * 10 ? x : m), a[0]);
        const fin = i + L === n && PARTICLES.has(top.w) ? 1.2 : 0; // particule en fin de phrase (你好吗, 好吧…)
        const sc = best[i].score + logp(top.f) + bonus(top.w) + fin - 0.3;
        if (!best[i + L] || sc > best[i + L].score) best[i + L] = { score: sc, words: best[i].words.concat([top]) };
      }
    }
    return best[n];
  }

  /** Candidats pour un tampon : [{w, consume, e, py}] */
  I.candidates = function (buf, wholeOnly) {
    if (!B.lex.ready) return [];
    const parts = [];
    let off = 0;
    for (const chunk of buf.split("'")) {
      if (chunk) parts.push({ letters: chunk, off });
      off += chunk.length + 1;
    }
    if (!parts.length) return [];
    // découpage : on enchaîne les morceaux séparés par « ' »
    let segs = [[]];
    for (const p of parts) {
      const ss = segmentations(p.letters);
      if (!ss.length) return [];
      const next = [];
      for (const a of segs) for (const s of ss) next.push(a.concat(s.map((x) => ({ ...x, a: x.a + p.off, b: x.b + p.off }))));
      segs = next.slice(0, 4);
    }
    const out = [];
    const seen = new Set();
    const push = (w, consume, e, score) => {
      const k = w + '|' + consume;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ w, consume, e, score });
    };
    const scored = [];
    for (const seq of segs) {
      const n = seq.length;
      const endAll = buf.length;
      // phrase entière
      if (n >= 2 && seq.every((x) => !x.partial || x === seq[n - 1])) {
        const s = sentence(seq);
        if (s && s.words.length > 1) scored.push({ w: s.words.map((x) => x.w).join(''), consume: endAll, e: null, score: 1000 + s.score });
      }
      // mots couvrant tout
      for (const x of wordsFor(seq)) scored.push({ w: x.w, consume: endAll, e: x.e, score: 900 + x.f / 10 + bonus(x.w) });
      if (wholeOnly) continue;
      // préfixes : k premières syllabes
      for (let k = n - 1; k >= 1; k--) {
        const sub = seq.slice(0, k);
        const list = wordsFor(sub).slice(0, k === 1 ? 40 : 12);
        const consume = seq[k - 1].b;
        for (const x of list) scored.push({ w: x.w, consume, e: x.e, score: k * 100 + x.f / 10 + bonus(x.w) });
      }
    }
    // la phrase n'est en tête que si elle bat le meilleur mot entier
    const sent = scored.filter((c) => c.score >= 1000).sort((a, b) => b.score - a.score)[0];
    const whole = scored.filter((c) => c.score >= 900 && c.score < 1000).sort((a, b) => b.score - a.score);
    const rest = scored.filter((c) => c.score < 900).sort((a, b) => b.score - a.score);
    if (sent && whole[0] && (sent.score - 1000) < logp(whole[0].e ? whole[0].e.f : 0) - 0.5) whole.splice(1, 0, sent);
    else if (sent) whole.unshift(sent);
    for (const c of whole.concat(rest)) push(c.w, c.consume, c.e);
    return out.slice(0, 120);
  };

  /** Conversion d'un texte pinyin déjà écrit (« nǐ hǎo », « ni3 hao3 », « nihao ») : candidats couvrant tout */
  I.convertText = function (text) {
    const plain = B.plainSyl(text.normalize('NFC')).toLowerCase()
      .replace(/ü/g, 'v').replace(/[1-5]/g, '').replace(/[\s\-·']+/g, "'").replace(/^'+|'+$/g, '');
    if (!/^[a-z']+$/.test(plain)) return [];
    return I.candidates(plain, true).filter((c) => c.consume === plain.length).slice(0, 8);
  };

  /* ---------------- interface ---------------- */
  let box = null;
  function ensureBox() {
    if (box) return box;
    box = B.h('div#imebox', { role: 'listbox', 'aria-label': 'Candidats pinyin', hidden: true });
    box.addEventListener('pointerdown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) commit(+b.dataset.i);
      const nav = e.target.closest('[data-nav]');
      if (nav) { page(+nav.dataset.nav); }
    });
    document.body.appendChild(box);
    return box;
  }
  function render() {
    ensureBox();
    if (!I.buf) { box.hidden = true; return; }
    const start = I.page * PER_PAGE;
    const list = I.cands.slice(start, start + PER_PAGE);
    const pretty = prettyBuf();
    box.replaceChildren(
      B.h('div.imebuf', B.h('span', pretty), B.h('span.imehelp', 'Espace ou 1-' + Math.max(1, list.length) + ' : choisir · Entrée : garder les lettres · Échap')),
      list.length
        ? B.h('div.imecands', ...list.map((c, i) => B.h('button', { class: 'ic' + (i === I.sel ? ' on' : ''), 'data-i': start + i, lang: 'zh-CN' },
          B.h('span.n', String(i + 1)), B.h('span.w', c.w),
          B.h('span.g', c.e ? B.lex.shortGloss(c.w, c.e) : c.w.length > 1 ? 'phrase' : ''))),
          B.h('span.nav', B.h('button', { 'data-nav': -1, disabled: I.page === 0, title: 'Page précédente (−)' }, '‹'),
            B.h('button', { 'data-nav': 1, disabled: start + PER_PAGE >= I.cands.length, title: 'Page suivante (=)' }, '›')))
        : B.h('div.imenone', B.lex.ready ? 'Aucun mot pour « ' + I.buf + ' ». Entrée pour garder les lettres.' : 'Dictionnaire en chargement…'));
    box.hidden = false;
    place();
  }
  function prettyBuf() {
    const s = segmentations(I.buf.replace(/'/g, ''))[0];
    if (!s || I.buf.includes("'")) return I.buf;
    return s.map((x) => x.s).join("'");
  }
  function place() {
    const r = I.adapter && I.adapter.rect();
    if (!r) return;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let x = Math.min(r.left, window.innerWidth - bw - 8);
    let y = r.bottom + 6;
    if (y + bh > window.innerHeight - 8) y = r.top - bh - 6;
    box.style.left = Math.max(8, x) + 'px';
    box.style.top = Math.max(8, y) + 'px';
  }
  function page(d) {
    const max = Math.max(0, Math.ceil(I.cands.length / PER_PAGE) - 1);
    I.page = Math.min(max, Math.max(0, I.page + d));
    I.sel = 0;
    render();
  }
  function update() {
    I.cands = I.candidates(I.buf);
    I.page = 0;
    I.sel = 0;
    render();
  }
  function commit(idx) {
    const c = I.cands[idx];
    if (!c) return;
    I.adapter.insert(c.w);
    picks[c.w] = (picks[c.w] || 0) + 1;
    savePicks();
    I.buf = I.buf.slice(c.consume).replace(/^'+/, '');
    if (I.buf) update();
    else cancel();
  }
  function commitRaw() {
    I.adapter.insert(I.buf.replace(/'/g, ''));
    cancel();
  }
  function cancel() {
    I.buf = '';
    I.cands = [];
    if (box) box.hidden = true;
  }
  I.cancel = cancel;
  I.active = () => !!I.buf;

  /**
   * Gestion d'une touche. adapter = { insert(text), rect(), before() -> texte avant le curseur }
   * Renvoie true si la touche est consommée.
   */
  I.handleKey = function (e, adapter) {
    if (!I.on || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
      if (I.buf && (e.ctrlKey || e.metaKey || e.altKey)) cancel();
      return false;
    }
    I.adapter = adapter;
    const k = e.key;
    if (!I.buf) {
      if (/^[a-z]$/.test(k)) {
        if (!B.lex.ready) B.lex.load();
        I.buf = k;
        update();
        return true;
      }
      if (PUNCT[k] && !(k === '.' && /\d$/.test(adapter.before()))) {
        adapter.insert(PUNCT[k]);
        return true;
      }
      return false;
    }
    if (/^[a-z]$/i.test(k) || (k === "'" && !I.buf.endsWith("'"))) { I.buf += k.toLowerCase(); update(); return true; }
    if (k === 'Backspace') { I.buf = I.buf.slice(0, -1); if (I.buf) update(); else cancel(); return true; }
    if (k === 'Escape') { cancel(); return true; }
    if (k === ' ') { if (I.cands.length) commit(I.page * PER_PAGE + I.sel); else commitRaw(); return true; }
    if (k === 'Enter') { commitRaw(); return true; }
    if (/^[1-9]$/.test(k)) { commit(I.page * PER_PAGE + (+k - 1)); return true; }
    if (k === 'ArrowRight') { if (I.sel < PER_PAGE - 1 && I.page * PER_PAGE + I.sel + 1 < I.cands.length) { I.sel++; render(); } else page(1); return true; }
    if (k === 'ArrowLeft') { if (I.sel > 0) { I.sel--; render(); } else if (I.page > 0) { page(-1); I.sel = PER_PAGE - 1; render(); } return true; }
    if (k === '=' || k === 'PageDown' || k === 'ArrowDown') { page(1); return true; }
    if (k === '-' || k === 'PageUp' || k === 'ArrowUp') { page(-1); return true; }
    if (PUNCT[k]) { if (I.cands.length) commit(I.page * PER_PAGE + I.sel); else commitRaw(); adapter.insert(PUNCT[k]); return true; }
    if (k === 'Tab') { page(1); return true; }
    if (k.length === 1) { commitRaw(); return false; }
    return true; // autres touches (flèches haut/bas, etc.) bloquées pendant la composition
  };

  /** Maj pressée puis relâchée seule : bascule 中 / FR */
  let shiftAlone = false;
  document.addEventListener('keydown', (e) => {
    shiftAlone = e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey;
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' && shiftAlone && B.ime.canToggle && B.ime.canToggle(e.target)) I.toggle();
    shiftAlone = false;
  }, true);
  document.addEventListener('pointerdown', () => { shiftAlone = false; }, true);

  I.toggle = function (force) {
    I.on = force == null ? !I.on : !!force;
    if (!I.on) cancel();
    if (B.settings) { B.settings.ime = I.on; localStorage.setItem('biji.settings', JSON.stringify(B.settings)); }
    B.$$('[data-act="ime"]').forEach((b) => {
      b.classList.toggle('on', I.on);
      b.textContent = I.on ? '中 pinyin→汉字' : 'FR clavier';
    });
    document.body.classList.toggle('ime-on', I.on);
  };

  /** Branche l'IME sur un <input> ordinaire */
  I.attachInput = function (input) {
    const adapter = {
      insert(t) {
        const s = input.selectionStart, e = input.selectionEnd;
        input.setRangeText(t, s, e, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      rect: () => input.getBoundingClientRect(),
      before: () => input.value.slice(0, input.selectionStart),
    };
    input.addEventListener('keydown', (e) => { if (I.handleKey(e, adapter)) e.preventDefault(); });
    input.addEventListener('blur', () => cancel());
    input.dataset.ime = '1';
  };
  window.addEventListener('resize', () => box && !box.hidden && place());
  window.addEventListener('scroll', () => box && !box.hidden && place(), true);
})();
