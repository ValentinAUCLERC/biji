/* Biji — coquille : barre latérale, routage, barre d'outils, réglages */
(function () {
  const B = window.Biji;
  const A = (B.app = {});
  const DEFAULTS = { pinyin: 'show', toneColors: true, fingerDraw: false, toneConv: true, voice: '' };
  B.settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('biji.settings') || '{}'));
  A.saveSettings = () => { localStorage.setItem('biji.settings', JSON.stringify(B.settings)); applySettings(); };
  function applySettings() {
    document.body.dataset.pinyin = B.settings.pinyin;
    document.body.classList.toggle('tones', !!B.settings.toneColors);
  }

  const INKS = [
    { kind: 'pen', color: '#1f1d1a', label: 'Stylo noir' },
    { kind: 'pen', color: '#c8382b', label: 'Stylo rouge' },
    { kind: 'pen', color: '#2b5fc4', label: 'Stylo bleu' },
    { kind: 'hl', color: '#ffd54a', label: 'Surligneur' },
    { kind: 'eraser', color: '', label: 'Gomme (ou bouton du stylet)' },
  ];

  function toolbar() {
    const tools = INKS.map((t, i) => B.h('button.tool', {
      title: t.label, 'data-tool': i,
      class: (B.tool.kind === t.kind && (t.kind === 'eraser' || B.tool.kind === 'hl' || B.tool.color === t.color)) ? 'on' : null,
      onclick: () => {
        B.tool.kind = t.kind;
        if (t.kind === 'pen') B.tool.color = t.color;
        if (t.kind === 'hl') B.tool.hlColor = t.color;
        B.$$('#toolbar .tool').forEach((b) => b.classList.toggle('on', +b.dataset.tool === i));
      },
    }, t.kind === 'eraser' ? B.h('span.er') : B.h('span.dot', { style: `background:${t.color}` + (t.kind === 'hl' ? ';border-radius:3px;width:16px;height:10px' : '') })));
    return B.h('div#toolbar',
      B.h('button.icon.menu', { title: 'Cours', onclick: () => document.body.classList.toggle('side-open') }, '☰'),
      B.h('button.pill', { 'data-act': 'pad', class: B.pad.open ? 'on' : null, title: 'Pavé d’écriture manuscrite (Alt+H)', onclick: () => B.pad.toggle() }, '✍ 手写'),
      B.h('button.pill#pinbtn', { title: 'Affichage du pinyin (Alt+P)', onclick: cyclePinyin }, PIN[B.settings.pinyin]),
      B.h('span.sep'),
      ...tools,
      B.h('button.icon', { title: 'Annuler le dernier trait (Ctrl+Z hors texte)', onclick: () => B.lastInk && B.lastInk.undo() }, '↶'),
      B.h('span.grow'),
      B.h('span#savestate'));
  }
  const PIN = { show: 'Pinyin : affiché', hover: 'Pinyin : au survol', hide: 'Pinyin : masqué' };
  function cyclePinyin() {
    const order = ['show', 'hover', 'hide'];
    B.settings.pinyin = order[(order.indexOf(B.settings.pinyin) + 1) % 3];
    A.saveSettings();
    const b = B.$('#pinbtn');
    if (b) b.textContent = PIN[B.settings.pinyin];
  }

  A.renderSide = function () {
    const side = B.$('#side');
    const q = (B.$('#search') && B.$('#search').value.trim().toLowerCase()) || '';
    const cur = (location.hash.match(/^#\/c\/(.+)$/) || [])[1];
    const list = B.store.list().filter((l) => {
      if (!q) return true;
      const hay = [l.title, ...(l.blocks || []).map((b) => b.text || b.chars || ''), ...(l.vocab || []).map((v) => v.hz + ' ' + v.py + ' ' + v.fr)].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const ul = B.$('#lessons', side);
    ul.replaceChildren(...list.map((l) => B.h('li', B.h('a', { href: '#/c/' + l.id, class: l.id === cur ? 'on' : null },
      B.h('span.lt', l.title || 'Sans titre'), B.h('span.ld', B.fmtDate(l.date) + ((l.vocab || []).length ? ' · ' + l.vocab.length + ' mots' : ''))))));
    if (!list.length) ul.appendChild(B.h('li.none', q ? 'Aucun cours ne correspond.' : 'Pas encore de cours.'));
    const ds = B.$('#dirstate', side);
    const S = B.store;
    ds.replaceChildren(
      S.dirState === 'granted' ? B.h('span.ok', '● Dossier : ' + S.dir.name)
        : S.dirState === 'prompt' ? B.h('button.warn', { onclick: async () => { if (await S.reconnect()) { A.renderSide(); route(); } } }, '⚠ Reconnecter « ' + S.dir.name + ' »')
          : B.h('button.warn', { onclick: async () => { if (await S.pickDir()) { A.renderSide(); B.toast('Les notes sont maintenant enregistrées dans le dossier'); } } }, '⚠ Choisir un dossier pour les notes'));
  };

  function side() {
    return B.h('aside#side',
      B.h('a.brand', { href: '#/' }, B.h('span.seal', { lang: 'zh-CN', 'aria-hidden': 'true' }, B.h('span', '笔'), B.h('span', '记')), B.h('span.bn', 'Bǐjì', B.h('small', 'notes de chinois'))),
      B.h('button.new', { onclick: newLesson }, '+ Nouveau cours'),
      B.h('input#search', { type: 'search', placeholder: 'Chercher (titre, hanzi, pinyin, sens)', oninput: B.debounce(A.renderSide, 150) }),
      B.h('ul#lessons'),
      B.h('div.sfoot',
        B.h('a', { href: '#/revision' }, 'Réviser le vocabulaire'),
        B.h('a', { href: '#/reglages' }, 'Réglages et sauvegarde'),
        B.h('div#dirstate')));
  }

  function newLesson() {
    const n = B.store.list().length + 1;
    const l = B.store.create({ title: 'Cours ' + n });
    location.hash = '#/c/' + l.id;
  }

  function home() {
    B.editor.lesson = null;
    const S = B.store;
    const page = B.$('#page');
    const recent = S.list().slice(0, 1)[0];
    page.replaceChildren(B.h('div.home',
      B.h('h1', 'Prendre ses notes de chinois, ', B.h('em', 'au clavier et au stylet.')),
      B.h('ol.how',
        B.h('li', B.h('b', 'Taper '), 'les hanzi avec le clavier chinois de Windows : le pinyin s’affiche au-dessus. Taper « ni3 » écrit « nǐ ».'),
        B.h('li', B.h('b', 'Écrire '), 'un caractère inconnu au stylet dans le pavé ✍ 手写 : choisir le bon candidat, il s’insère dans les notes.'),
        B.h('li', B.h('b', 'Cliquer '), 'sur un mot : sens en français, prononciation, ordre des traits, ajout au vocabulaire.'),
        B.h('li', B.h('b', 'S’entraîner '), 'dans des cases 田 avec le modèle en transparence, puis réviser le vocabulaire de chaque cours.')),
      B.h('div.cta',
        B.h('button.primary', { onclick: newLesson }, '+ Nouveau cours'),
        recent ? B.h('a.ghost', { href: '#/c/' + recent.id }, 'Reprendre « ' + (recent.title || 'sans titre') + ' »') : null),
      S.dirState !== 'granted' ? B.h('div.notice',
        B.h('p', S.dirState === 'prompt'
          ? 'Le dossier de notes « ' + S.dir.name + ' » doit être reconnecté (le navigateur redemande l’autorisation à chaque ouverture).'
          : 'Les notes sont pour l’instant gardées dans ce navigateur seulement. Choisir un dossier (par exemple dans OneDrive) pour avoir de vrais fichiers, sauvegardés et lisibles.'),
        B.h('button', { onclick: async () => { if (await (S.dirState === 'prompt' ? S.reconnect() : S.pickDir())) { A.renderSide(); home(); } } },
          S.dirState === 'prompt' ? 'Reconnecter le dossier' : 'Choisir le dossier des notes')) : null));
  }

  function settingsPage() {
    B.editor.lesson = null;
    const st = B.settings;
    const row = (label, ctrl, help) => B.h('div.srow', B.h('label', label, ctrl), help ? B.h('p.hint', help) : null);
    const chk = (k) => B.h('input', { type: 'checkbox', checked: !!st[k], onchange: (e) => { st[k] = e.target.checked; A.saveSettings(); } });
    const voices = B.voice.list();
    const imp = B.h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      try { const n = await B.store.importFile(e.target.files[0]); B.toast(n + ' cours importé(s)'); A.renderSide(); } catch (err) { B.toast(err.message, 5000); }
    } });
    const S = B.store;
    B.$('#page').replaceChildren(B.h('div.settings',
      B.h('h1', 'Réglages'),
      B.h('h2', 'Stockage'),
      B.h('p', S.dirState === 'granted' ? 'Les notes sont enregistrées dans le dossier « ' + S.dir.name + ' » (un fichier .json par cours) et dans ce navigateur.'
        : 'Pas de dossier connecté : les notes ne sont que dans ce navigateur.'),
      B.h('div.btns',
        B.h('button', { onclick: async () => { if (await S.pickDir()) { A.renderSide(); settingsPage(); } } }, S.dir ? 'Changer de dossier' : 'Choisir un dossier'),
        S.dir ? B.h('button.ghost', { onclick: async () => { await S.forgetDir(); A.renderSide(); settingsPage(); } }, 'Ne plus utiliser de dossier') : null,
        B.h('button.ghost', { onclick: S.exportAll }, 'Exporter une sauvegarde (.json)'),
        B.h('button.ghost', { onclick: () => imp.click() }, 'Importer une sauvegarde'), imp),
      B.h('h2', 'Affichage'),
      row('Pinyin ', B.h('select', { onchange: (e) => { st.pinyin = e.target.value; A.saveSettings(); B.$('#pinbtn').textContent = PIN[st.pinyin]; } },
        ...[['show', 'affiché'], ['hover', 'caché, visible au survol'], ['hide', 'masqué']].map(([v, t]) => B.h('option', { value: v, selected: st.pinyin === v }, t)))),
      row(['Couleurs des tons ', chk('toneColors')], null, 'Ton 1 rouge, 2 vert, 3 bleu, 4 violet, neutre gris.'),
      B.h('h2', 'Saisie'),
      row(['Conversion « ni3 » → « nǐ » à la frappe ', chk('toneConv')], null, 'Taper la syllabe puis le chiffre du ton (5 = ton neutre). « v » donne « ü » : « lv4 » → « lǜ ».'),
      row(['Dessiner aussi au doigt ', chk('fingerDraw')], null, 'Désactivé : le doigt fait défiler la page et seuls le stylet et la souris dessinent (la paume posée est ignorée).'),
      B.h('h2', 'Voix'),
      voices.length
        ? row('Voix chinoise ', B.h('select', { onchange: (e) => { st.voice = e.target.value; A.saveSettings(); B.voice.speak('你好，我是你的中文老师。'); } },
          B.h('option', { value: '' }, 'automatique'), ...voices.map((v) => B.h('option', { value: v.name, selected: st.voice === v.name }, v.name))))
        : B.h('p.hint', 'Aucune voix chinoise détectée. Edge en propose d’office (voix « Xiaoxiao Online »). Sinon : Paramètres Windows › Heure et langue › Voix › Ajouter des voix › Chinois (simplifié).'),
      B.h('button.ghost', { onclick: () => B.voice.speak('你好，我是你的中文老师。') }, '🔊 Tester'),
      B.h('h2', 'Crédits'),
      B.h('p.hint', 'Dictionnaire : CFDICT (Chine Informations, CC BY-SA 3.0) et compléments french-cedict (Laowai, CC BY-SA 4.0), CC-CEDICT (MDBG, CC BY-SA 4.0). Pinyin : pinyin-pro (MIT). Traits : Hanzi Writer (MIT) et Make Me a Hanzi (Arphic Public License). Reconnaissance : HanziLookupJS (GPL).')));
  }

  function route() {
    const h = location.hash || '#/';
    document.body.classList.remove('side-open');
    B.card.close();
    let m;
    if ((m = h.match(/^#\/c\/(.+)$/))) {
      const l = B.store.get(m[1]);
      if (!l) { location.hash = '#/'; return; }
      document.body.dataset.view = 'lesson';
      B.editor.open(l);
    } else if ((m = h.match(/^#\/revision(?:\/(.+))?$/))) {
      document.body.dataset.view = 'review';
      B.editor.lesson = null;
      B.review.open(m[1] || '');
    } else if (h === '#/reglages') {
      document.body.dataset.view = 'settings';
      settingsPage();
    } else {
      document.body.dataset.view = 'home';
      home();
    }
    A.renderSide();
    window.scrollTo(0, 0);
  }

  A.start = async function () {
    applySettings();
    document.body.append(side(), B.h('main#main', toolbar(), B.h('div#page')));
    await B.store.init().catch((e) => B.toast('Stockage indisponible : ' + e.message, 6000));
    window.addEventListener('hashchange', route);
    document.addEventListener('biji:lessons', () => { A.renderSide(); if (!B.$('.editing') && !document.activeElement.matches('input,textarea')) route(); });
    route();
    B.store.status(B.store.dirState === 'granted' ? 'Dossier « ' + B.store.dir.name + ' »' : 'Notes dans le navigateur');
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); B.pad.toggle(); }
      if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); cyclePinyin(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('textarea,input') && B.lastInk) { e.preventDefault(); B.lastInk.undo(); }
    });
    // le dictionnaire (15 Mo) se charge après le premier affichage
    setTimeout(() => B.lex.load().catch((e) => B.toast(e.message, 6000)), 50);
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (location.hash === '#/reglages') settingsPage(); };
  };
})();
