/* Biji — dictionnaire, segmentation, pinyin, voix, données de traits */
import { pinyin as pinyinPro } from 'pinyin-pro';

(function () {
  const B = window.Biji;

  /* ---------- Dictionnaire (chargé à la demande, 15 Mo) ---------- */
  const lex = (B.lex = { ready: false, map: new Map(), maxLen: 1, bySyl: new Map() });
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
        const [s, t, p, fr, en, f] = raw.slice(start, end).split('\t');
        start = end + 1;
        const e = { s, t, p, fr: fr ? fr.split('|') : [], en: en ? en.split('|') : [], f: +f || 0 };
        add(s, e);
        if (t !== s) add(t, e);
        indexSyl(e);
      }
      for (const a of lex.bySyl.values()) a.sort((x, y) => y.f - x.f);
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
  /** Index pinyin sans ton -> mots (pour la saisie pinyin -> hanzi). Clé : « ni hao » */
  function indexSyl(e) {
    if (!B.HAN.test(e.s) || /[A-Za-z0-9·，]/.test(e.s)) return;
    const syl = e.p.toLowerCase().replace(/u:/g, 'v').split(' ').map((x) => x.replace(/[1-5]$/, ''));
    if (syl.length !== [...e.s].length || syl.some((x) => !/^[a-z]+$/.test(x))) return;
    if (/^(variante|variant of|ancienne variante|old variant|forme archaïque)/i.test(e.fr[0] || e.en[0] || '')) return;
    const k = syl.join(' ');
    let a = lex.bySyl.get(k);
    if (!a) lex.bySyl.set(k, (a = []));
    let f = e.f + (e.p[0] === e.p[0].toLowerCase() ? 0 : -8);
    // caractère polyphone : la fréquence est celle du caractère, pas de cette lecture -> on pénalise les lectures secondaires
    if (syl.length === 1 && e.f > 30) {
      const main = pinyinPro(e.s, { toneType: 'none', v: true });
      if (main && main !== syl[0]) f -= 25;
    }
    const prev = a.find((x) => x.w === e.s);
    if (prev) { if (f > prev.f) prev.f = f; return; }
    a.push({ w: e.s, f, e });
  }

  /** Entrées triées : lecture la plus probable en premier */
  lex.lookup = function (w) {
    const a = (lex.map.get(w) || []).slice();
    return a.sort((x, y) => score(y) - score(x));
    function score(e) {
      let s = 0;
      if (e.s === w) s += 4;
      if (e.fr.length) s += 2;
      if (e.p[0] === e.p[0].toLowerCase()) s += 1;
      if (/variante|variant of|utilisé dans|used in/i.test(e.fr[0] || e.en[0] || '')) s -= 3;
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
  /** Sens très court (candidats de saisie) */
  lex.shortGloss = function (w, e) {
    e = e || lex.lookup(w)[0];
    if (!e) return '';
    let g = (e.fr[0] || e.en[0] || '').replace(/\([^)]*\)\s*/g, '').replace(/\[[^\]]*\]/g, '').trim();
    if (!g) g = (e.fr[1] || e.en[1] || '').replace(/\([^)]*\)\s*/g, '').trim();
    return g.length > 20 ? g.slice(0, 19) + '…' : g;
  };

  /** Pinyin contextuel d'une suite de hanzi, une syllabe par caractère */
  lex.pinyinRun = function (run) {
    try {
      return pinyinPro(run, { type: 'array', toneType: 'symbol' });
    } catch (e) {
      return [...run].map(() => '');
    }
  };

  /** Caractère courant qui se lit s+t (pour faire entendre une syllabe à la voix) : {ch, py, exact}. t = 0 : ton libre. */
  lex.charFor = function (s, t) {
    const list = (lex.bySyl.get(s) || []).filter((x) => [...x.w].length === 1);
    if (!list.length) return null;
    const tone = (x) => +(x.e.p.match(/([1-5])$/) || [0, 5])[1];
    const main = (x) => pinyinPro(x.w, { toneType: 'num', v: true }).replace(/0$/, '5');
    const pick = (t && (list.find((x) => tone(x) === t && main(x) === s + t) || list.find((x) => tone(x) === t)))
      || list.find((x) => main(x) === s + tone(x)) || list[0];
    return { ch: pick.w, py: B.numToMarks(pick.e.p.toLowerCase()), exact: !t || tone(pick) === t };
  };

  /** Pinyin d'un mot pour le vocab : lecture du dictionnaire qui colle au contexte, sinon pinyin-pro */
  lex.bestReading = function (word, ctxPy) {
    const auto = ctxPy || lex.pinyinRun(word).join(' ');
    const ents = lex.lookup(word);
    const same = ents.find((e) => B.numToMarks(e.p).toLowerCase() === auto.toLowerCase());
    return { py: same ? B.numToMarks(same.p) : auto, entry: same || ents[0] || null };
  };

  /* ---------- Voix (Web Speech, voix chinoise du système) ---------- */
  B.voice = {
    list() {
      if (!('speechSynthesis' in window)) return [];
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
  B.strokeDataSync = (ch) => hwCache.get(ch);
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
