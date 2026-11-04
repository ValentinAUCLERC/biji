/* Biji — coquille : barre latérale, routage, barre d'outils, réglages */
(function () {
  const B = window.Biji;
  const A = (B.app = {});
  const DEFAULTS = { pinyin: 'show', toneColors: true, fingerDraw: false, toneConv: true, voice: '', ime: false, onlineHw: true };
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
    { kind: 'eraser', color: '', label: 'Gomme (le bout gomme du stylet marche aussi)' },
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
    const bar = B.h('div#toolbar',
      B.h('button.icon.menu', { title: 'Cours', onclick: () => document.body.classList.toggle('side-open') }, '☰'),
      B.h('button.pill', { 'data-act': 'pad', class: B.pad.open ? 'on' : null, title: 'Pavé d’écriture manuscrite (Alt+H)', onclick: () => B.pad.toggle() }, '✍ 手写'),
      B.h('button.pill#pinbtn', { title: 'Affichage du pinyin (Alt+P)', onclick: cyclePinyin }, PIN[B.settings.pinyin]),
      B.h('span.sep'),
      ...tools,
      B.h('button.icon', { title: 'Annuler le dernier trait', onclick: () => B.lastInk && B.lastInk.undo() }, '↶'),
      B.h('span.sep'),
      B.h('button.pill.rec', { 'data-act': 'rec', onclick: recClick }, '● Enregistrer'),
      B.h('button.pill', { 'data-act': 'recpause', hidden: true, onclick: () => B.rec.pause() }, '❚❚ Pause'),
      B.h('span.grow'),
      B.h('span#savestate'));
    // les boutons ne gardent pas le focus : sinon Espace (dans les notes) « recliquerait » sur ● Enregistrer
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    return bar;
  }
  async function recClick() {
    const R = B.rec;
    if (R.state === 'idle') {
      if (!B.editor.lesson) return B.toast('Ouvrir (ou créer) le cours à enregistrer d’abord');
      return R.start(B.editor.lesson);
    }
    if (confirm('Arrêter l’enregistrement (' + B.fmtTime(R.elapsed()) + ') ?')) await R.stop();
  }
  const PIN = { show: 'Pinyin : affiché', hover: 'Pinyin : au survol', hide: 'Pinyin : masqué' };
  function cyclePinyin() {
    const order = ['show', 'hover', 'hide'];
    B.settings.pinyin = order[(order.indexOf(B.settings.pinyin) + 1) % 3];
    A.saveSettings();
    const b = B.$('#pinbtn');
    if (b) b.textContent = PIN[B.settings.pinyin];
  }

  function lessonText(l) {
    return [l.title, l.doc ? B.docText(l.doc) : (l.blocks || []).map((b) => b.text || b.chars || '').join(' '),
      ...(l.vocab || []).map((v) => v.hz + ' ' + v.py + ' ' + v.fr)].join(' ').toLowerCase();
  }
  A.renderSide = function () {
    const side = B.$('#side');
    const q = (B.$('#search') && B.$('#search').value.trim().toLowerCase()) || '';
    const cur = (location.hash.match(/^#\/c\/(.+)$/) || [])[1];
    const list = B.store.list().filter((l) => !q || lessonText(l).includes(q));
    const ul = B.$('#lessons', side);
    ul.replaceChildren(...list.map((l) => B.h('li', B.h('a', { href: '#/c/' + l.id, class: l.id === cur ? 'on' : null },
      B.h('span.lt', l.title || 'Sans titre'),
      B.h('span.ld', B.fmtDate(l.date) + ((l.vocab || []).length ? ' · ' + l.vocab.length + ' mots' : '') + ((l.recordings || []).length ? ' · 🎙' + l.recordings.length : ''))))));
    if (!list.length) ul.appendChild(B.h('li.none', q ? 'Aucun cours ne correspond.' : 'Pas encore de cours.'));
    const ds = B.$('#dirstate', side);
    const S = B.store;
    ds.replaceChildren(
      S.dirState === 'granted' ? B.h('span.ok', '● Dossier : ' + S.dir.name)
        : S.dirState === 'prompt' ? B.h('button.warn', { onclick: async () => { if (await S.reconnect()) { A.renderSide(); route(); } } }, '⚠ Reconnecter « ' + S.dir.name + ' »')
          : window.showDirectoryPicker ? B.h('button.warn', { onclick: async () => { if (await S.pickDir()) { A.renderSide(); B.toast('Les notes sont maintenant enregistrées dans le dossier'); } } }, '⚠ Choisir un dossier pour les notes')
            : B.h('span.hint', 'Notes gardées dans ce navigateur (exporter régulièrement)'));
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
    const l = B.store.create({ title: 'Cours ' + n, doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    location.hash = '#/c/' + l.id;
  }

  function home() {
    const S = B.store;
    const page = B.$('#page');
    const recent = S.list()[0];
    page.replaceChildren(B.h('div.home',
      B.h('h1', 'Prendre ses notes de chinois, ', B.h('em', 'au clavier et au stylet.')),
      B.h('ol.how',
        B.h('li', B.h('b', 'Taper '), 'en pinyin : bouton « 中 pinyin→汉字 » (ou Maj seule), taper « nihao » puis Espace → 你好, avec le sens sous chaque proposition. Le pinyin s’affiche au-dessus des caractères. Clavier français : « ni3 » donne « nǐ ».'),
        B.h('li', B.h('b', 'Écrire '), 'au stylet dans le pavé ✍ 手写 (un mot entier, jusqu’à 3 caractères), ou dessiner dans les notes (✏ Dessin). Le bout gomme du stylet efface.'),
        B.h('li', B.h('b', 'Enregistrer '), 'le cours (● Enregistrer) et poser des repères ⏱ dans les notes pour réécouter un passage.'),
        B.h('li', B.h('b', 'Cliquer '), 'sur un mot : sens en français, prononciation, ordre des traits, ajout au vocabulaire. Sélectionner du pinyin propose les caractères.'),
        B.h('li', B.h('b', 'S’entraîner '), 'dans des cases 田, puis réviser le vocabulaire de chaque cours.')),
      B.h('div.cta',
        B.h('button.primary', { onclick: newLesson }, '+ Nouveau cours'),
        recent ? B.h('a.ghost', { href: '#/c/' + recent.id }, 'Reprendre « ' + (recent.title || 'sans titre') + ' »') : null),
      S.dirState !== 'granted' && window.showDirectoryPicker ? B.h('div.notice',
        B.h('p', S.dirState === 'prompt'
          ? 'Le dossier de notes « ' + S.dir.name + ' » doit être reconnecté (le navigateur redemande l’autorisation à chaque ouverture).'
          : 'Les notes sont pour l’instant gardées dans ce navigateur seulement. Choisir un dossier (par exemple dans OneDrive) pour avoir de vrais fichiers, sauvegardés, avec les enregistrements audio.'),
        B.h('button', { onclick: async () => { if (await (S.dirState === 'prompt' ? S.reconnect() : S.pickDir())) { A.renderSide(); home(); } } },
          S.dirState === 'prompt' ? 'Reconnecter le dossier' : 'Choisir le dossier des notes')) : null));
  }

  function penTest() {
    const out = B.h('pre.pentest', 'Poser le stylet ici (pointe, puis bout gomme, puis bouton latéral)…');
    const zone = B.h('div.penzone', 'Zone de test du stylet');
    const show = (e) => {
      out.textContent = `type : ${e.pointerType}   bouton : ${e.button}   boutons : ${e.buttons}   pression : ${(e.pressure || 0).toFixed(2)}\n` +
        `→ ${B.isEraser(e) ? 'GOMME détectée ✓' : e.pointerType === 'pen' ? 'pointe du stylet' : e.pointerType === 'touch' ? 'doigt' : 'souris'}`;
    };
    ['pointerdown', 'pointermove'].forEach((t) => zone.addEventListener(t, (e) => { if (t === 'pointerdown' || e.buttons) show(e); }));
    zone.style.touchAction = 'none';
    return B.h('div', zone, out);
  }

  function settingsPage() {
    const st = B.settings;
    const row = (label, ctrl, help) => B.h('div.srow', B.h('label', label, ctrl), help ? B.h('p.hint', help) : null);
    const chk = (k, after) => B.h('input', { type: 'checkbox', checked: !!st[k], onchange: (e) => { st[k] = e.target.checked; A.saveSettings(); if (after) after(); } });
    const voices = B.voice.list();
    const imp = B.h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      try { const n = await B.store.importFile(e.target.files[0]); B.toast(n + ' cours importé(s)'); A.renderSide(); } catch (err) { B.toast(err.message, 5000); }
    } });
    const S = B.store;
    B.$('#page').replaceChildren(B.h('div.settings',
      B.h('h1', 'Réglages'),
      B.h('h2', 'Stockage'),
      B.h('p', S.dirState === 'granted' ? 'Les notes sont enregistrées dans le dossier « ' + S.dir.name + ' » (un fichier .json par cours, l’audio dans audio/) et dans ce navigateur.'
        : 'Pas de dossier connecté : les notes et l’audio ne sont que dans ce navigateur.'),
      B.h('div.btns',
        window.showDirectoryPicker ? B.h('button', { onclick: async () => { if (await S.pickDir()) { A.renderSide(); settingsPage(); } } }, S.dir ? 'Changer de dossier' : 'Choisir un dossier') : null,
        S.dir ? B.h('button.ghost', { onclick: async () => { await S.forgetDir(); A.renderSide(); settingsPage(); } }, 'Ne plus utiliser de dossier') : null,
        B.h('button.ghost', { onclick: S.exportAll }, 'Exporter une sauvegarde (.json, sans l’audio)'),
        B.h('button.ghost', { onclick: () => imp.click() }, 'Importer une sauvegarde'), imp),
      B.h('h2', 'Affichage'),
      row('Pinyin ', B.h('select', { onchange: (e) => { st.pinyin = e.target.value; A.saveSettings(); B.$('#pinbtn').textContent = PIN[st.pinyin]; } },
        ...[['show', 'affiché'], ['hover', 'caché, visible au survol'], ['hide', 'masqué']].map(([v, t]) => B.h('option', { value: v, selected: st.pinyin === v }, t)))),
      row(['Couleurs des tons ', chk('toneColors')], null, 'Ton 1 rouge, 2 vert, 3 bleu, 4 violet, neutre gris.'),
      B.h('h2', 'Saisie'),
      row(['Saisie pinyin → 汉字 activée à l’ouverture ', chk('ime', () => B.ime.toggle(st.ime))], null, 'Bascule à tout moment avec Maj (appui seul) ou le bouton « 中 / FR ». Espace = 1er choix, 1-9 = choix, Entrée = garder les lettres, l’apostrophe sépare les syllabes (xi’an → 西安).'),
      row(['Conversion « ni3 » → « nǐ » à la frappe ', chk('toneConv')], null, 'En clavier français : taper la syllabe puis le chiffre du ton (5 = neutre). « v » donne « ü » : « lv4 » → « lǜ ».'),
      B.h('h2', 'Stylet'),
      row(['Reconnaissance d’écriture en ligne (Google) ', chk('onlineHw')], null, 'Beaucoup plus fiable et lit des mots entiers. Les tracés du pavé 手写 (et seulement eux) sont envoyés à Google. Désactivé, ou sans connexion : moteur local, moins précis, un caractère par case.'),
      row(['Dessiner aussi au doigt ', chk('fingerDraw')], null, 'Désactivé : le doigt fait défiler la page et seuls le stylet et la souris dessinent (la paume posée est ignorée).'),
      penTest(),
      B.h('p.hint', 'Si le bout gomme n’est pas reconnu ici, c’est le pilote du stylet qui ne le signale pas au navigateur (Paramètres Windows › Bluetooth et appareils › Stylet et Windows Ink, ou logiciel du fabricant : affecter « Gomme » au bout/bouton). Le bouton Gomme de la barre d’outils marche dans tous les cas.'),
      B.h('h2', 'Voix'),
      voices.length
        ? row('Voix chinoise ', B.h('select', { onchange: (e) => { st.voice = e.target.value; A.saveSettings(); B.voice.speak('你好，我是你的中文老师。'); } },
          B.h('option', { value: '' }, 'automatique'), ...voices.map((v) => B.h('option', { value: v.name, selected: st.voice === v.name }, v.name))))
        : B.h('p.hint', 'Aucune voix chinoise détectée. Edge en propose d’office (voix « Xiaoxiao Online »). Sinon : Paramètres Windows › Heure et langue › Voix › Ajouter des voix › Chinois (simplifié).'),
      B.h('button.ghost', { onclick: () => B.voice.speak('你好，我是你的中文老师。') }, '🔊 Tester'),
      B.h('h2', 'À propos'),
      B.h('p.hint', 'Version ' + (window.BIJI_BUILD || 'dev') + '. Code : github.com/ValentinAUCLERC/biji'),
      B.h('p.hint', 'Dictionnaire : CFDICT (Chine Informations, CC BY-SA 3.0) et compléments french-cedict (Laowai, CC BY-SA 4.0), CC-CEDICT (MDBG, CC BY-SA 4.0). Fréquences : wordfreq (CC BY-SA 4.0). Pinyin : pinyin-pro (MIT). Traits : Hanzi Writer (MIT) et Make Me a Hanzi (Arphic Public License). Reconnaissance hors ligne : HanziLookupJS (GPL). Éditeur : TipTap (MIT).')));
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
      if (B.editor.lesson !== l) B.editor.open(l);
    } else {
      B.editor.close();
      if ((m = h.match(/^#\/revision(?:\/(.+))?$/))) {
        document.body.dataset.view = 'review';
        B.review.open(m[1] || '');
      } else if (h === '#/reglages') {
        document.body.dataset.view = 'settings';
        settingsPage();
      } else {
        document.body.dataset.view = 'home';
        home();
      }
    }
    A.renderSide();
    window.scrollTo(0, 0);
  }

  A.start = async function () {
    applySettings();
    document.body.append(side(), B.h('main#main', B.h('div#top', toolbar(), B.h('div#fmtslot')), B.h('div#page')));
    await B.store.init().catch((e) => B.toast('Stockage indisponible : ' + e.message, 6000));
    B.ime.toggle(!!B.settings.ime);
    window.addEventListener('hashchange', route);
    document.addEventListener('biji:lessons', () => {
      A.renderSide();
      const ed = B.editor.editor;
      const cur = B.editor.lesson;
      // le dossier contenait une version plus récente du cours ouvert : on recharge s'il n'est pas en cours d'édition
      if (cur && B.store.get(cur.id) !== cur && !(ed && ed.isFocused)) { B.editor.close(); route(); }
    });
    route();
    B.store.status(B.store.dirState === 'granted' ? 'Dossier « ' + B.store.dir.name + ' »' : 'Notes dans le navigateur');
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.altKey && k === 'h') { e.preventDefault(); B.pad.toggle(); }
      if (e.altKey && k === 'p') { e.preventDefault(); cyclePinyin(); }
      if (e.altKey && k === 'm') { e.preventDefault(); B.editor.insertStamp(); }
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.target.closest('textarea,input,.ProseMirror') && B.lastInk) { e.preventDefault(); B.lastInk.undo(); }
    });
    B.rec.recover().catch((e) => console.warn(e));
    // le dictionnaire (15 Mo) se charge après le premier affichage
    setTimeout(() => B.lex.load().catch((e) => B.toast(e.message, 6000)), 50);
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (location.hash === '#/reglages') settingsPage(); };
    registerSW();
  };

  /** Hors ligne (GitHub Pages) : service worker ; pas en file:// */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || /[?&]nosw/.test(location.search)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            const bar = B.h('div#update', 'Nouvelle version de Biji disponible. ',
              B.h('button', { onclick: () => { B.store.flush().then(() => location.reload()); } }, 'Recharger'));
            document.body.appendChild(bar);
          }
        });
      });
    }).catch((e) => console.warn('SW', e));
  }
})();
