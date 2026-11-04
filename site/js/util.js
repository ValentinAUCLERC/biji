/* Biji — utilitaires partagés (scripts classiques : le site doit marcher en file://) */
(function () {
  const B = (window.Biji = window.Biji || {});

  B.$ = (s, r = document) => r.querySelector(s);
  B.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /** Création d'élément : h('div.cls#id', {attr}, enfants...) */
  B.h = function (sel, attrs, ...kids) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => {
      if (p[0] === '.') el.classList.add(p.slice(1));
      else el.id = p.slice(1);
    });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      kids.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) k.forEach(add);
      else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  };

  // replaceChildren/append insèrent « null » en texte : on filtre les valeurs vides
  for (const m of ['replaceChildren', 'append', 'prepend']) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); };
  }

  B.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  B.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  B.debounce = (fn, ms) => {
    let t;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
    d.flush = (...a) => {
      clearTimeout(t);
      fn(...a);
    };
    return d;
  };
  B.HAN = /\p{Script=Han}/u;
  B.isHan = (ch) => B.HAN.test(ch);
  B.hasHan = (s) => B.HAN.test(s || '');

  B.toast = function (msg, ms = 2600) {
    let t = B.$('#toast');
    if (!t) document.body.appendChild((t = B.h('div#toast', { role: 'status' })));
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), ms);
  };

  /* ---------- Pinyin : tons ---------- */
  const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
  const UNMARK = {};
  for (const [v, s] of Object.entries(MARKS)) [...s].forEach((c, i) => (UNMARK[c] = [v, i + 1]));

  /** « hao » + 3 -> « hǎo » ; « lv »/« lu: » -> « lü » ; ton 5/0 = neutre */
  B.markSyllable = function (syl, tone) {
    const upper = syl[0] && syl[0] !== syl[0].toLowerCase();
    let s = syl.toLowerCase().replace(/u:|v/g, 'ü');
    tone = +tone;
    if (tone >= 1 && tone <= 4) {
      let idx = s.indexOf('a');
      if (idx < 0) idx = s.indexOf('e');
      if (idx < 0) idx = s.indexOf('ou');
      if (idx < 0) {
        for (let i = s.length - 1; i >= 0; i--) if ('iouü'.includes(s[i])) { idx = i; break; }
      }
      if (idx >= 0) s = s.slice(0, idx) + MARKS[s[idx]][tone - 1] + s.slice(idx + 1);
    }
    return upper ? s[0].toUpperCase() + s.slice(1) : s;
  };

  /** « ni3 hao3 » (CEDICT) -> « nǐ hǎo » */
  B.numToMarks = (py) =>
    py.split(' ').map((w) => {
      const m = w.match(/^([A-Za-zü:]+?)([1-5])$/);
      return m ? B.markSyllable(m[1], m[2]) : w.replace('u:', 'ü');
    }).join(' ');

  /** ton d'une syllabe accentuée (5 = neutre) */
  B.toneOf = function (syl) {
    for (const c of syl.normalize('NFC')) if (UNMARK[c]) return UNMARK[c][1];
    const m = syl.match(/([1-5])$/);
    return m ? +m[1] : 5;
  };

  /** syllabe accentuée -> forme comparable sans ton : « lǚ » -> « lü » */
  B.plainSyl = (s) => [...s.normalize('NFC').toLowerCase()].map((c) => (UNMARK[c] ? UNMARK[c][0] : c)).join('').replace(/[1-5]$/, '').replace(/u:|v/g, 'ü');

  const SYL = new Set((window.BIJI_SYL || '').split(' '));
  /** Conversion à la frappe : si le texte avant le curseur finit par « hao3 », renvoie {len, text:'hǎo'} */
  B.convertTypedTone = function (before) {
    const m = before.match(/(^|[^A-Za-zü:])([A-Za-zü:]{1,6})([1-5])$/);
    if (!m) return null;
    const key = m[2].toLowerCase().replace(/u:|ü/g, 'v');
    if (!SYL.has(key)) return null;
    return { len: m[2].length + 1, text: B.markSyllable(m[2], m[3]) };
  };

  /** Date courte FR */
  B.fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  B.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** Charge un script local (file:// interdit fetch, pas <script>) */
  const loaded = {};
  B.loadScript = (src) =>
    loaded[src] ||
    (loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => {
        delete loaded[src];
        rej(new Error('Chargement impossible : ' + src));
      };
      document.head.appendChild(s);
    }));
})();
