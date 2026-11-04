/* Biji — fiche d'un mot / caractère : pinyin, sens FR (EN en secours), voix, ordre des traits */
(function () {
  const B = window.Biji;
  const C = (B.card = {});
  let panel, writers = [];

  function ensure() {
    if (panel) return panel;
    panel = B.h('aside#card', { 'aria-label': 'Fiche', hidden: true });
    document.body.appendChild(panel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !e.target.closest('textarea,input')) C.close(); });
    return panel;
  }
  C.close = () => { if (panel) { panel.hidden = true; document.body.classList.remove('card-open'); } };

  function pyEl(pyMarked) {
    return B.h('span.py', ...pyMarked.split(' ').map((s, i) => [i ? ' ' : '', B.h('span', { class: 't' + B.toneOf(s) }, s)]));
  }
  function senses(e, max) {
    const ul = B.h('ul.senses');
    const fr = e.fr.slice(0, max);
    if (fr.length) fr.forEach((s) => ul.appendChild(B.h('li', s)));
    else e.en.slice(0, max).forEach((s) => ul.appendChild(B.h('li', { lang: 'en' }, s)));
    const box = B.h('div', ul);
    if (!fr.length && e.en.length) box.prepend(B.h('span.tag', 'anglais (pas de traduction française)'));
    if (fr.length && e.en.length) box.appendChild(B.h('details.en', B.h('summary', 'Sens anglais'), B.h('p', { lang: 'en' }, e.en.join(' ; '))));
    return box;
  }

  /**
   * ctx : { block, chars:[{ch,line,col,py}], focusChar } quand on vient d'un bloc texte (permet de corriger le pinyin)
   */
  C.open = async function (word, ctx = {}) {
    ensure();
    writers.forEach((w) => { try { w.target && w.target.node && w.target.node.remove(); } catch (e) {} });
    writers = [];
    if (!B.lex.ready) {
      panel.replaceChildren(B.h('p.hint', 'Chargement du dictionnaire…'));
      panel.hidden = false;
      document.body.classList.add('card-open');
      await B.lex.load();
    }
    const ents = B.lex.lookup(word);
    const ctxPy = ctx.chars ? ctx.chars.map((c) => c.py).join(' ') : B.lex.pinyinRun(word).join(' ');
    const head = B.h('header.chead',
      B.h('div.big', { lang: 'zh-CN' }, word),
      B.h('div.cbtns',
        B.h('button', { title: 'Écouter', onclick: () => B.voice.speak(word) }, '🔊'),
        B.h('button', { title: 'Écouter lentement', onclick: () => B.voice.speak(word, true) }, '🐢'),
        B.h('button.icon', { title: 'Fermer (Échap)', onclick: C.close }, '✕')));
    const sub = B.h('div.ctx', pyEl(ctxPy),
      B.editor.lesson ? B.h('button.primary', { onclick: (e) => { if (B.editor.addVocab(word, ctxPy)) e.target.textContent = '✓ Dans le vocabulaire'; } },
        B.editor.lesson.vocab.some((v) => v.hz === word) ? '✓ Dans le vocabulaire' : '+ Vocabulaire') : null);

    const readings = B.h('section.readings');
    if (ents.length) {
      ents.slice(0, 5).forEach((e) => {
        const trad = e.t !== e.s ? B.h('span.trad', { lang: 'zh-TW', title: 'Forme traditionnelle' }, '繁 ' + e.t) : null;
        readings.appendChild(B.h('div.reading', B.h('div.rhead', pyEl(B.numToMarks(e.p)), trad), senses(e, 8)));
      });
    } else if ([...word].length > 1) {
      readings.appendChild(B.h('p.hint', 'Expression absente du dictionnaire : voir chaque caractère ci-dessous.'));
    } else {
      readings.appendChild(B.h('p.hint', 'Caractère absent du dictionnaire.'));
    }

    const chars = [...word].filter(B.isHan);
    const charsSec = B.h('section.chars', B.h('h3', chars.length > 1 ? 'Caractère par caractère' : 'Écriture'));
    chars.forEach((ch, i) => {
      const ce = B.lex.lookup(ch);
      const box = B.h('div.hw', { lang: 'zh-CN' });
      const info = B.h('div.cinfo',
        B.h('div.cl', B.h('strong', { lang: 'zh-CN' }, ch), ' ', pyEl(ctx.chars && ctx.chars[i] ? ctx.chars[i].py : (B.lex.pinyinRun(ch)[0] || ''))),
        B.h('div.cg', B.lex.gloss(ce[0], 3)));
      const btns = B.h('div.cact');
      const tile = B.h('div.ctile', box, B.h('div', info, btns));
      charsSec.appendChild(tile);
      let writer = null;
      const mk = () => {
        if (writer) return writer;
        writer = window.HanziWriter.create(box, ch, {
          width: 132, height: 132, padding: 6, charDataLoader: B.hwLoader,
          showOutline: true, strokeAnimationSpeed: 1.1, delayBetweenStrokes: 180,
          strokeColor: '#1f1d1a', radicalColor: '#c8382b', outlineColor: '#e6dccb',
          drawingColor: '#2b5fc4', drawingWidth: 6, showHintAfterMisses: 2, highlightOnComplete: true,
          onLoadCharDataError: () => { box.replaceChildren(B.h('span.nodata', ch)); btns.replaceChildren(B.h('span.hint', 'Pas de données de traits')); },
        });
        writers.push(writer);
        return writer;
      };
      mk();
      btns.append(
        B.h('button', { onclick: () => { mk().cancelQuiz(); mk().animateCharacter(); } }, '▶ Traits'),
        B.h('button', { onclick: () => {
          const w = mk();
          w.hideCharacter();
          w.quiz({ onComplete: (s) => B.toast(s.totalMistakes ? `Terminé avec ${s.totalMistakes} erreur(s)` : 'Parfait, aucune erreur !') });
          B.toast('À toi : trace le caractère dans la case, trait par trait');
        } }, '✍ S’entraîner'),
        ce.length > 0 && [...word].length > 1 ? B.h('button', { onclick: () => C.open(ch, {}) }, 'Fiche') : null);
      // correction du pinyin quand on vient d'un bloc texte
      if (ctx.block && ctx.chars && ctx.chars[i]) {
        const opts = [...new Set(ce.map((e) => B.numToMarks(e.p).toLowerCase()))].filter((p) => !/\s/.test(p));
        if (opts.length > 1) {
          const cur = ctx.chars[i].py;
          const sel = B.h('select', { 'aria-label': 'Corriger le pinyin de ' + ch },
            B.h('option', { value: '' }, 'Pinyin auto'),
            ...opts.map((p) => B.h('option', { value: p, selected: !!ctx.chars[i].fixed && p === cur.toLowerCase() }, p)));
          sel.addEventListener('change', () => {
            const c = ctx.chars[i];
            ctx.block.text = B.setPinyinOverride(ctx.block.text, c.line, c.col, sel.value);
            B.store.touch(B.editor.lesson);
            const el = B.$(`[data-id="${ctx.block.id}"]`);
            if (el && el._render) el._render();
            B.toast(sel.value ? `Pinyin de ${ch} fixé à « ${sel.value} »` : `Pinyin de ${ch} remis en automatique`);
          });
          info.appendChild(B.h('label.fix', 'Lecture ici : ', sel));
        }
      }
    });

    panel.replaceChildren(head, sub, readings, chars.length ? charsSec : null,
      B.h('p.credit', 'Dictionnaire : CFDICT / french-cedict, CC-CEDICT (CC BY-SA). Traits : Make Me a Hanzi.'));
    panel.hidden = false;
    panel.scrollTop = 0;
    document.body.classList.add('card-open');
  };
})();
