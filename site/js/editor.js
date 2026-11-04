/* Biji — page d'un cours : blocs texte / dessin / cases 田, vocabulaire */
(function () {
  const B = window.Biji;
  const E = (B.editor = { lesson: null, inks: [], active: null });
  B.target = null; // { block, ta, pos:[s,e] } : où insérer ce qui vient du pavé d'écriture

  const save = () => E.lesson && B.store.touch(E.lesson);

  E.open = function (lesson) {
    E.inks.forEach((i) => i.destroy());
    E.inks = [];
    E.lesson = lesson;
    B.target = null;
    const page = B.$('#page');
    page.replaceChildren(
      B.h('header.lhead',
        B.h('input.ltitle', { value: lesson.title, placeholder: 'Titre du cours', 'aria-label': 'Titre du cours',
          oninput: (e) => { lesson.title = e.target.value; save(); B.app.renderSide(); } }),
        B.h('div.lmeta',
          B.h('input', { type: 'date', value: lesson.date || '', 'aria-label': 'Date du cours',
            onchange: (e) => { lesson.date = e.target.value; save(); B.app.renderSide(); } }),
          B.h('button.ghost', { onclick: () => (location.hash = '#/revision/' + lesson.id) }, 'Réviser ce cours'),
          B.h('button.ghost.danger', { onclick: () => {
            if (confirm('Supprimer le cours « ' + (lesson.title || 'sans titre') + ' » ?')) { B.store.remove(lesson.id); location.hash = '#/'; }
          } }, 'Supprimer'))),
      B.h('div#blocks'),
      B.h('div.addbar',
        B.h('button', { onclick: () => E.add('text', true) }, '+ Texte'),
        B.h('button', { onclick: () => E.add('ink', true) }, '+ Dessin libre'),
        B.h('button', { onclick: () => E.add('grid', true) }, '+ Cases 田')),
      B.h('section#vocab'));
    if (!lesson.blocks.length) E.add('text', false);
    E.renderBlocks();
    E.renderVocab();
    const first = lesson.blocks[0];
    if (lesson.blocks.length === 1 && first.type === 'text' && !first.text) setTimeout(() => focusText(first.id), 50);
  };

  E.renderBlocks = function () {
    E.inks.forEach((i) => i.destroy());
    E.inks = [];
    const wrap = B.$('#blocks');
    wrap.replaceChildren(...E.lesson.blocks.map((b) => blockEl(b)));
  };

  E.add = function (type, atEnd) {
    const b = { id: 'b' + B.uid(), type };
    if (type === 'text') b.text = '';
    if (type === 'ink') { b.h = 420; b.strokes = []; }
    if (type === 'grid') { b.chars = ''; b.reps = 7; b.cells = {}; }
    const bl = E.lesson.blocks;
    const i = !atEnd && E.active ? bl.findIndex((x) => x.id === E.active) : -1;
    if (i >= 0) bl.splice(i + 1, 0, b); else bl.push(b);
    save();
    if (B.$('#blocks')) {
      E.renderBlocks();
      const el = B.$(`[data-id="${b.id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      if (type === 'text') focusText(b.id);
      if (type === 'grid') { const inp = el && B.$('.gridchars', el); if (inp) inp.focus(); }
    }
    E.active = b.id;
    return b;
  };

  function blockEl(b) {
    const el = B.h('div', { class: 'blk blk-' + b.type, 'data-id': b.id });
    el.addEventListener('pointerdown', () => { E.active = b.id; }, true);
    el.addEventListener('focusin', () => { E.active = b.id; });
    el.appendChild(B.h('div.gut',
      B.h('button', { title: 'Monter', onclick: () => move(b, -1) }, '↑'),
      B.h('button', { title: 'Descendre', onclick: () => move(b, 1) }, '↓'),
      B.h('button', { title: 'Supprimer le bloc', onclick: () => del(b) }, '✕')));
    if (b.type === 'text') textBlock(b, el);
    if (b.type === 'ink') inkBlock(b, el);
    if (b.type === 'grid') gridBlock(b, el);
    return el;
  }
  function move(b, d) {
    const bl = E.lesson.blocks;
    const i = bl.indexOf(b), j = i + d;
    if (j < 0 || j >= bl.length) return;
    [bl[i], bl[j]] = [bl[j], bl[i]];
    save();
    E.renderBlocks();
  }
  function del(b) {
    const empty = (b.type === 'text' && !b.text.trim()) || (b.type === 'ink' && !b.strokes.length) || (b.type === 'grid' && !b.chars);
    if (!empty && !confirm('Supprimer ce bloc ?')) return;
    E.lesson.blocks.splice(E.lesson.blocks.indexOf(b), 1);
    save();
    E.renderBlocks();
  }

  /* ---------------- Bloc texte ---------------- */
  function textBlock(b, el) {
    const view = B.h('div.zh-view', { lang: 'zh-CN' });
    const ta = B.h('textarea.zh-edit', { rows: 1, spellcheck: 'false', placeholder: 'Taper ici. Pinyin : « ni3 hao3 » donne « nǐ hǎo ». Titre : « # … », liste : « - … »' });
    const live = B.h('div.live', { 'aria-live': 'polite' });
    ta.value = b.text;
    el.append(view, ta, live);
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    const setEditing = (on) => {
      el.classList.toggle('editing', on);
      if (on) autosize();
      else { B.renderText(b.text, view); live.textContent = ''; }
    };
    el._render = () => { if (!el.classList.contains('editing')) B.renderText(b.text, view); else { ta.value = b.text; autosize(); } };
    const track = () => { B.target = { block: b, ta, el, pos: [ta.selectionStart, ta.selectionEnd] }; };
    const updLive = B.debounce(() => {
      const before = ta.value.slice(0, ta.selectionStart);
      const li = before.split('\n').length - 1;
      const line = ta.value.split('\n')[li] || '';
      if (B.hasHan(line)) live.replaceChildren(B.renderLine(line, li));
      else live.textContent = '';
    }, 120);

    view.addEventListener('click', (e) => {
      const r = e.target.closest('ruby');
      const w = e.target.closest('.w');
      if (w && r) {
        const chars = B.$$('ruby', w).map((x) => ({ ch: x.dataset.ch, line: +x.dataset.l, col: +x.dataset.c, py: x.querySelector('rt').textContent, fixed: x.classList.contains('fixed') }));
        B.card.open(w.dataset.w, { block: b, chars, focusChar: +[...w.children].indexOf(r) });
        return;
      }
      setEditing(true);
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
      track();
    });
    ta.addEventListener('focus', () => { setEditing(true); track(); updLive(); });
    ta.addEventListener('blur', () => {
      track();
      setTimeout(() => { if (document.activeElement !== ta && b.text.trim()) setEditing(false); }, 150);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ta.blur(); }
    });
    ['keyup', 'click', 'select'].forEach((ev) => ta.addEventListener(ev, () => { track(); updLive(); }));
    ta.addEventListener('input', (e) => {
      if (B.settings.toneConv && !e.isComposing && e.inputType === 'insertText' && /^[1-5]$/.test(e.data || '')) {
        const s = ta.selectionStart;
        const conv = B.convertTypedTone(ta.value.slice(0, s));
        if (conv) {
          ta.setSelectionRange(s - conv.len, s);
          document.execCommand('insertText', false, conv.text);
        }
      }
      b.text = ta.value;
      autosize();
      track();
      updLive();
      save();
      E.vocabSoon();
    });
    setEditing(!b.text.trim());
    if (!b.text.trim()) el.classList.add('editing');
  }
  function focusText(id) {
    const ta = B.$(`[data-id="${id}"] textarea`);
    if (ta) ta.focus();
  }

  /** Insère du texte (ou efface n caractères) à l'endroit mémorisé — appelé par le pavé d'écriture */
  B.insertText = function (text, backspace) {
    if (!E.lesson) return B.toast('Ouvrir un cours d’abord');
    let t = B.target;
    if (!t || !document.contains(t.ta)) {
      const last = [...E.lesson.blocks].reverse().find((x) => x.type === 'text');
      const b = last || E.add('text', true);
      if (!last) E.renderBlocks();
      const el = B.$(`[data-id="${b.id}"]`);
      const ta = B.$('textarea', el);
      t = B.target = { block: b, ta, el, pos: [ta.value.length, ta.value.length] };
    }
    const { ta, block, el } = t;
    let [s, e] = t.pos;
    if (backspace) {
      if (s === e && s > 0) s -= (s >= 2 && /[\uDC00-\uDFFF]/.test(ta.value[s - 1])) ? 2 : 1;
      ta.setRangeText('', s, e, 'end');
      t.pos = [s, s];
    } else {
      ta.setRangeText(text, s, e, 'end');
      t.pos = [s + text.length, s + text.length];
    }
    if (document.activeElement === ta) ta.setSelectionRange(t.pos[0], t.pos[1]);
    block.text = ta.value;
    save();
    el._render();
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    E.vocabSoon();
  };

  /* ---------------- Bloc dessin ---------------- */
  function inkBlock(b, el) {
    const cv = B.h('canvas.inkc');
    const grip = B.h('div.grip', { title: 'Glisser pour agrandir' }, '⋯');
    el.append(cv, grip);
    const ink = new B.Ink(cv, {
      lw: 1000, lh: () => b.h, strokes: b.strokes,
      bg: (ctx, s, w, h) => {
        ctx.fillStyle = '#d9cfbd';
        const step = 40 * s;
        for (let y = step; y < h; y += step) for (let x = step; x < w; x += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      },
      grow: () => { b.h += 240; },
      onChange: save,
    });
    E.inks.push(ink);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = b.h;
      const mv = (ev) => { b.h = Math.max(160, Math.round(h0 + (ev.clientY - y0) / ink.scale)); ink.layout(); };
      const upf = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upf); save(); };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', upf);
    });
  }

  /* ---------------- Bloc cases 田 (entraînement) ---------------- */
  function gridBlock(b, el) {
    const inp = B.h('input.gridchars', { value: b.chars, placeholder: 'Caractères à pratiquer (ex. 你好)', lang: 'zh-CN', 'aria-label': 'Caractères à pratiquer' });
    const reps = B.h('select', { 'aria-label': 'Nombre de cases' }, ...[4, 7, 10, 14].map((n) => B.h('option', { value: n, selected: n === b.reps }, n + ' cases')));
    const rows = B.h('div.gridrows');
    el.append(B.h('div.gridhead', B.h('span.lbl', '田 Entraînement'), inp, reps,
      B.h('button.ghost', { title: 'Effacer mes tracés', onclick: () => { if (confirm('Effacer tous les tracés de ce bloc ?')) { b.cells = {}; save(); draw(); } } }, 'Effacer')), rows);
    const draw = () => {
      E.inks = E.inks.filter((i) => { if (rows.contains(i.c)) { i.destroy(); return false; } return true; });
      const chars = [...new Set([...b.chars].filter(B.isHan))];
      rows.replaceChildren(...chars.map((ch) => {
        const py = B.lex.pinyinRun(ch)[0] || '';
        const model = B.h('canvas.cell.model', { title: 'Ordre des traits de ' + ch });
        const row = B.h('div.gridrow', B.h('div.cellwrap', B.h('span.cellpy', { class: 't' + B.toneOf(py) }, py), model));
        const mInk = new B.Ink(model, { lw: 100, lh: () => 100, strokes: [], bg: (ctx, s, w, h) => { B.bgTian(ctx, s, w, h); paintModel(ctx, ch, w, '#1f1d1a', 0.9); } });
        model.style.pointerEvents = 'none';
        E.inks.push(mInk);
        row.firstChild.addEventListener('click', () => B.card.open(ch, {}));
        for (let i = 0; i < b.reps; i++) {
          const key = ch + ':' + i;
          if (!b.cells[key]) b.cells[key] = [];
          const cv = B.h('canvas.cell');
          row.appendChild(B.h('div.cellwrap', cv));
          const ghost = i < 2 ? 0.18 : i < 3 ? 0.08 : 0;
          E.inks.push(new B.Ink(cv, {
            lw: 100, lh: () => 100, strokes: b.cells[key], penScale: 1.4,
            bg: (ctx, s, w, h) => { B.bgTian(ctx, s, w, h); if (ghost) paintModel(ctx, ch, w, '#1f1d1a', ghost); },
            onChange: save,
          }));
        }
        return row;
      }));
      if (!chars.length) rows.appendChild(B.h('p.hint', 'Taper (ou écrire au pavé 手写) les caractères à pratiquer : chaque caractère a son modèle, puis des cases à remplir, les premières avec le modèle en transparence.'));
    };
    inp.addEventListener('input', B.debounce(() => { b.chars = inp.value.trim(); save(); draw(); }, 400));
    inp.addEventListener('focus', () => { B.target = { block: { set text(v) { inp.value = v; b.chars = v; save(); draw(); }, get text() { return inp.value; } }, ta: inp, el: { _render() {}, classList: el.classList, offsetWidth: 0 }, pos: [inp.value.length, inp.value.length] }; });
    reps.addEventListener('change', () => { b.reps = +reps.value; save(); draw(); });
    draw();
  }
  function paintModel(ctx, ch, w, color, alpha) {
    const cached = B._hwSync && B._hwSync.get(ch);
    const doPaint = (data) => { ctx.save(); ctx.globalAlpha = alpha; B.drawModel(ctx, data, w * 0.06, w * 0.06, w * 0.88, color); ctx.restore(); };
    if (cached) return doPaint(cached);
    B.strokeData(ch).then((d) => {
      (B._hwSync = B._hwSync || new Map()).set(ch, d);
      E.inks.forEach((i) => { if (i.o.bg && i.c.isConnected) i.redraw(); });
    }).catch(() => {});
  }

  /* ---------------- Vocabulaire du cours ---------------- */
  E.vocabSoon = B.debounce(() => E.renderVocab(), 900);
  E.addVocab = function (word, py, fr) {
    const L = E.lesson;
    if (!L) return false;
    if (L.vocab.some((v) => v.hz === word)) { B.toast('« ' + word + ' » est déjà dans le vocabulaire'); return false; }
    if (!py || fr == null) {
      const r = B.lex.bestReading(word);
      py = py || r.py;
      fr = fr != null ? fr : B.lex.gloss(r.entry);
    }
    L.vocab.push({ id: 'v' + B.uid(), hz: word, py, fr, box: 0, due: 0, added: Date.now() });
    save();
    E.renderVocab();
    B.toast('Ajouté au vocabulaire : ' + word);
    return true;
  };
  E.renderVocab = function () {
    const sec = B.$('#vocab');
    if (!sec || !E.lesson) return;
    const L = E.lesson;
    const known = new Set(L.vocab.map((v) => v.hz));
    const found = [];
    const seen = new Set();
    for (const b of L.blocks) {
      if (b.type !== 'text') continue;
      for (const w of B.wordsIn(b.text)) {
        if (known.has(w) || seen.has(w)) continue;
        seen.add(w);
        if (B.lex.lookup(w).length) found.push(w);
      }
    }
    sec.replaceChildren(
      B.h('h2', 'Vocabulaire du cours ', B.h('span.count', String(L.vocab.length))),
      L.vocab.length
        ? B.h('div.vlist', ...L.vocab.map((v) => B.h('div.vrow',
          B.h('button.vhz', { lang: 'zh-CN', title: 'Fiche', onclick: () => B.card.open(v.hz, {}) }, v.hz),
          B.h('input.vpy', { value: v.py, 'aria-label': 'Pinyin', onchange: (e) => { v.py = e.target.value; save(); } }),
          B.h('input.vfr', { value: v.fr, 'aria-label': 'Sens', onchange: (e) => { v.fr = e.target.value; save(); } }),
          B.h('button.icon', { title: 'Écouter', onclick: () => B.voice.speak(v.hz) }, '🔊'),
          B.h('button.icon', { title: 'Retirer', onclick: () => { L.vocab.splice(L.vocab.indexOf(v), 1); save(); E.renderVocab(); } }, '✕'))))
        : B.h('p.hint', 'Cliquer sur un mot dans les notes puis « + Vocabulaire », ou piocher dans les mots repérés ci-dessous.'),
      found.length
        ? B.h('div.found', B.h('span.lbl', 'Repérés dans les notes :'),
          ...found.map((w) => B.h('button.chip', { lang: 'zh-CN', title: 'Ajouter ' + w, onclick: () => E.addVocab(w) }, '+ ' + w)))
        : null);
  };

  document.addEventListener('biji:dict', () => {
    if (!E.lesson) return;
    B.$$('.blk-text').forEach((el) => el._render && el._render());
    E.renderVocab();
  });
})();
