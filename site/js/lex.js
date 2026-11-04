/* Biji — dictionnaire, segmentation, pinyin, voix, données de traits */
(function () {
  const B = window.Biji;

  /* ---------- Dictionnaire (chargé à la demande, 15 Mo) ---------- */
  const lex = (B.lex = { ready: false, map: new Map(), maxLen: 1 });
  let loading = null;
  lex.load = function () {
    if (loading) return loading;
    loading = B.loadScript('data/dict.js').then(() => {
      const raw = window.BIJI_DICT_RAW;
      window.BIJI_DICT_RAW = null;
      let start = 0;
      while (start < raw.length) {
        let end = raw.indexOf('\n', start);
        if (end < 0) end = raw.length;
        const [s, t, p, fr, en] = raw.slice(start, end).split('\t');
        start = end + 1;
        const e = { s, t, p, fr: fr ? fr.split('|') : [], en: en ? en.split('|') : [] };
        add(s, e);
        if (t !== s) add(t, e);
      }
      lex.ready = true;
      document.dispatchEvent(new CustomEvent('biji:dict'));
    });
    return loading;
  };
  function add(k, e) {
    const a = lex.map.get(k);
    if (a) a.push(e);
    else lex.map.set(k, [e]);
    if (k.length > lex.maxLen && k.length <= 8) lex.maxLen = k.length;
  }

  /** Entrées triées : lecture la plus probable en premier (FR présent, puis minuscule = nom commun) */
  lex.lookup = function (w) {
    const a = (lex.map.get(w) || []).slice();
    return a.sort((x, y) => score(y) - score(x));
    function score(e) {
      let s = 0;
      if (e.s === w) s += 4;
      if (e.fr.length) s += 2;
      if (e.p[0] === e.p[0].toLowerCase()) s += 1;
      if (/variante|variant of|utilisé dans|used in/i.test((e.fr[0] || e.en[0] || ''))) s -= 3;
      return s;
    }
  };

  /** Segmentation par plus long mot connu (suffisant pour des notes de débutant) */
  lex.segment = function (run) {
    const out = [];
    const chars = [...run];
    let i = 0;
    while (i < chars.length) {
      let len = 1;
      if (lex.ready) {
        for (let L = Math.min(lex.maxLen, chars.length - i); L >= 2; L--) {
          if (lex.map.has(chars.slice(i, i + L).join(''))) { len = L; break; }
        }
      }
      out.push(chars.slice(i, i + len).join(''));
      i += len;
    }
    return out;
  };

  /** Sens à afficher : FR, sinon EN (marqué) */
  lex.gloss = function (e, max = 3) {
    if (!e) return '';
    if (e.fr.length) return e.fr.slice(0, max).join(' ; ');
    return e.en.length ? '(en) ' + e.en.slice(0, max).join(' ; ') : '';
  };

  /** Pinyin contextuel d'une suite de hanzi (pinyin-pro), une syllabe par caractère */
  lex.pinyinRun = function (run) {
    try {
      return window.pinyinPro.pinyin(run, { type: 'array', toneType: 'symbol' });
    } catch (e) {
      return [...run].map(() => '');
    }
  };

  /** Pinyin d'un mot pour le vocab : lecture du dictionnaire qui colle au contexte, sinon pinyin-pro */
  lex.bestReading = function (word) {
    const auto = lex.pinyinRun(word).join(' ');
    const ents = lex.lookup(word);
    const same = ents.find((e) => B.numToMarks(e.p).toLowerCase() === auto.toLowerCase());
    return { py: same ? B.numToMarks(same.p) : auto, entry: same || ents[0] || null };
  };

  /* ---------- Voix (Web Speech, voix chinoise du système) ---------- */
  B.voice = {
    list() {
      return speechSynthesis.getVoices().filter((v) => /^zh[-_](CN|Hans)/i.test(v.lang) || /^cmn/i.test(v.lang));
    },
    pick() {
      const vs = B.voice.list();
      const want = B.settings && B.settings.voice;
      return vs.find((v) => v.name === want) ||
        vs.find((v) => /xiaoxiao|natural|online/i.test(v.name)) ||
        vs.find((v) => /google/i.test(v.name)) || vs[0] || null;
    },
    speak(text, slow) {
      if (!('speechSynthesis' in window)) return B.toast('Synthèse vocale indisponible dans ce navigateur');
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = B.voice.pick();
      if (v) u.voice = v;
      else if (!B.voice._warned) {
        B.voice._warned = true;
        B.toast('Aucune voix chinoise trouvée : utiliser Edge, ou ajouter la voix « Chinois (simplifié) » dans Windows', 5000);
      }
      u.lang = 'zh-CN';
      u.rate = slow ? 0.55 : 0.85;
      speechSynthesis.speak(u);
    },
  };
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  /* ---------- Données de traits Hanzi Writer (un fichier JS par caractère) ---------- */
  const hwCache = new Map();
  const hwWait = new Map();
  window.BIJI_HW = (ch, data) => {
    hwCache.set(ch, data);
    (hwWait.get(ch) || []).forEach((f) => f(data));
    hwWait.delete(ch);
  };
  B.strokeData = function (ch) {
    if (hwCache.has(ch)) return Promise.resolve(hwCache.get(ch));
    return new Promise((res, rej) => {
      if (!hwWait.has(ch)) hwWait.set(ch, []);
      hwWait.get(ch).push(res);
      B.loadScript('data/hw/' + ch.codePointAt(0).toString(16) + '.js').catch((e) => {
        hwWait.delete(ch);
        rej(e);
      });
    });
  };
  B.hwLoader = (ch, ok, ko) => B.strokeData(ch).then(ok, ko);

  /** Dessine le caractère modèle (contours Hanzi Writer) dans un contexte 2D, carré de taille size */
  B.drawModel = function (ctx, data, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 1024, -size / 1024);
    ctx.translate(0, -900);
    ctx.fillStyle = color;
    data.strokes.forEach((p) => ctx.fill(new Path2D(p)));
    ctx.restore();
  };
})();
