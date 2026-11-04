/* Biji — révision du vocabulaire (boîtes de Leitner simples) : lire (hanzi -> sens) ou écrire (sens -> hanzi au stylet) */
(function () {
  const B = window.Biji;
  const R = (B.review = {});
  const DAYS = [0, 1, 2, 4, 8, 16, 30];
  let st = null;

  function items(scope) {
    const out = [];
    for (const l of B.store.list()) {
      if (scope && l.id !== scope) continue;
      for (const v of l.vocab || []) out.push({ v, l });
    }
    return out;
  }

  R.open = function (scope) {
    const page = B.$('#page');
    const all = items(scope);
    const now = Date.now();
    const due = all.filter((x) => (x.v.due || 0) <= now);
    st = st && st.scope === scope ? st : { scope, mode: 'lire' };
    const lessons = B.store.list().filter((l) => (l.vocab || []).length);
    page.replaceChildren(
      B.h('header.rhead2',
        B.h('h1', 'Révision'),
        B.h('div.rctl',
          B.h('select', { 'aria-label': 'Cours à réviser', onchange: (e) => (location.hash = '#/revision' + (e.target.value ? '/' + e.target.value : '')) },
            B.h('option', { value: '' }, 'Tous les cours'),
            ...lessons.map((l) => B.h('option', { value: l.id, selected: l.id === scope }, l.title || 'Cours du ' + B.fmtDate(l.date)))),
          B.h('div.tabs', ...[['lire', 'Lire 读'], ['ecrire', 'Écrire 写']].map(([k, t]) =>
            B.h('button', { class: st.mode === k ? 'on' : null, onclick: () => { st.mode = k; R.open(scope); } }, t))))),
      B.h('p.rsum', all.length
        ? `${all.length} mot(s) au total, ${due.length} à revoir maintenant.`
        : 'Aucun mot de vocabulaire pour l’instant : en ajouter depuis les notes d’un cours (cliquer sur un mot, puis « + Vocabulaire »).'),
      B.h('div#rzone'));
    if (!all.length) return;
    const pool = (due.length ? due : all.slice().sort((a, b) => (a.v.due || 0) - (b.v.due || 0))).slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    st.queue = pool.slice(0, 20);
    st.done = 0; st.ok = 0;
    if (!due.length) B.$('.rsum').textContent += ' Rien d’urgent : session d’entraînement libre sur les mots les plus proches de leur échéance.';
    next();
  };

  function grade(x, knew) {
    const v = x.v;
    v.box = knew ? Math.min((v.box || 0) + 1, 6) : 0;
    v.due = Date.now() + (knew ? DAYS[v.box] * 864e5 : 0);
    B.store.touch(x.l);
    st.done++;
    if (knew) st.ok++;
    else if (!x.requeued) st.queue.push(Object.assign({}, x, { requeued: true }));
    next();
  }

  function answer(x) {
    return B.h('div.ans',
      B.h('div.apy', ...x.v.py.split(' ').map((s, i) => [i ? ' ' : '', B.h('span', { class: 't' + B.toneOf(s) }, s)])),
      B.h('div.afr', x.v.fr || '—'),
      B.h('div.abtn',
        B.h('button.again', { onclick: () => grade(x, false) }, 'À revoir'),
        B.h('button.good', { onclick: () => grade(x, true) }, 'Je savais')));
  }

  function next() {
    const z = B.$('#rzone');
    if (!z) return;
    const x = st.queue.shift();
    if (!x) {
      z.replaceChildren(B.h('div.rcard.end', B.h('div.big', '好！'),
        B.h('p', `Session terminée : ${st.ok} réussi(s) sur ${st.done}.`),
        B.h('button.primary', { onclick: () => R.open(st.scope) }, 'Recommencer')));
      return;
    }
    const prog = B.h('div.rprog', `${st.done + 1} / ${st.done + 1 + st.queue.length}`);
    if (st.mode === 'lire') {
      const card = B.h('div.rcard', prog, B.h('div.big', { lang: 'zh-CN' }, x.v.hz), B.h('div.from', x.l.title || ''));
      const show = B.h('button.primary', { onclick: () => { show.replaceWith(answer(x)); B.voice.speak(x.v.hz); } }, 'Voir la réponse');
      card.appendChild(show);
      z.replaceChildren(card);
      return;
    }
    // écrire : on montre le sens + pinyin, on trace chaque caractère
    const chars = [...x.v.hz].filter(B.isHan);
    const target = B.h('div.hwbig', { lang: 'zh-CN' });
    const status = B.h('div.wstat');
    const card = B.h('div.rcard', prog,
      B.h('div.afr.q', x.v.fr || '(pas de sens noté)'),
      B.h('div.apy', ...x.v.py.split(' ').map((s, i) => [i ? ' ' : '', B.h('span', { class: 't' + B.toneOf(s) }, s)]),
        ' ', B.h('button.icon', { title: 'Écouter', onclick: () => B.voice.speak(x.v.hz) }, '🔊')),
      B.h('div.wrow', target, status));
    z.replaceChildren(card);
    let idx = 0, mistakes = 0, writer = null;
    const finish = () => {
      status.replaceChildren(B.h('div.big.small', { lang: 'zh-CN' }, x.v.hz), B.h('p', mistakes ? `${mistakes} erreur(s) de trait` : 'Sans erreur'));
      card.appendChild(B.h('div.abtn',
        B.h('button.again', { onclick: () => grade(x, false) }, 'À revoir'),
        B.h('button.good', { onclick: () => grade(x, true) }, mistakes <= chars.length ? 'Je savais ✓' : 'Je savais')));
    };
    const reveal = B.h('button.ghost', { onclick: () => { mistakes += 5; if (writer) { writer.cancelQuiz(); writer.showCharacter(); } setTimeout(step, 1200); } }, 'Je ne sais pas');
    function step() {
      if (idx >= chars.length) { reveal.remove(); return finish(); }
      const ch = chars[idx++];
      target.replaceChildren();
      status.replaceChildren(B.h('p', `Caractère ${idx} / ${chars.length}`), reveal);
      writer = window.HanziWriter.create(target, ch, {
        width: 240, height: 240, padding: 10, charDataLoader: B.hwLoader, showCharacter: false, showOutline: false,
        drawingColor: '#1f1d1a', drawingWidth: 10, strokeColor: '#1f1d1a', highlightColor: '#2b5fc4', showHintAfterMisses: 3,
        onLoadCharDataError: () => { status.replaceChildren(B.h('p', `Pas de données de traits pour ${ch}`)); setTimeout(step, 800); },
      });
      writer.quiz({
        onMistake: () => { mistakes++; },
        onComplete: () => setTimeout(step, 500),
      });
    }
    if (!chars.length) return finish();
    step();
  }
})();
