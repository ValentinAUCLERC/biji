/* Biji — rendu du texte chinois (pinyin, mots cliquables) */
(function () {
  const B = window.Biji;
  const OVR = /(\p{Script=Han})\[([A-Za-zÀ-ɏü:1-5 ]{1,12})\]/gu;

  /** Retire les corrections « 行[háng] » : renvoie le texte propre, les pinyins imposés et la table d'index */
  function parseLine(line) {
    let clean = '', map = [], ov = new Map(), last = 0;
    line.replace(OVR, (m, ch, py, off) => {
      for (let i = last; i < off; i++) { map.push(i); clean += line[i]; }
      for (let i = 0; i < ch.length; i++) map.push(off + i);
      ov.set(clean.length, /\d/.test(py) ? B.numToMarks(py.trim()) : py.trim());
      clean += ch;
      last = off + m.length;
      return m;
    });
    for (let i = last; i < line.length; i++) { map.push(i); clean += line[i]; }
    return { clean, map, ov };
  }
  B.parseLine = parseLine;

  /** Rend une ligne : retourne un élément (div) avec ruby + mots cliquables */
  B.renderLine = function (line, lineIdx) {
    let cls = 'ln';
    let body = line;
    let shift = 0;
    const hm = line.match(/^(#{1,3})\s+/);
    const lm = line.match(/^\s*[-•*]\s+/);
    if (hm) { cls += ' h' + hm[1].length; shift = hm[0].length; }
    else if (lm) { cls += ' li'; shift = lm[0].length; }
    body = line.slice(shift);
    const el = B.h('div', { class: cls });
    if (!body.trim()) { el.classList.add('empty'); el.innerHTML = '&nbsp;'; return el; }
    const { clean, map, ov } = parseLine(body);
    const re = /\p{Script=Han}+/gu;
    let pos = 0, m;
    while ((m = re.exec(clean))) {
      if (m.index > pos) el.appendChild(document.createTextNode(clean.slice(pos, m.index)));
      const run = m[0];
      const pys = B.lex.pinyinRun(run);
      let k = 0;
      for (const w of B.lex.segment(run)) {
        const span = B.h('span.w', { 'data-w': w, lang: 'zh-CN' });
        for (const ch of w) {
          const ci = m.index + k;
          const py = ov.get(ci) || pys[k] || '';
          const r = B.h('ruby', { 'data-l': lineIdx, 'data-c': map[ci] + shift, 'data-ch': ch, class: ov.has(ci) ? 'fixed' : null },
            ch, B.h('rt', { class: 't' + B.toneOf(py) }, py));
          span.appendChild(r);
          k += ch.length;
        }
        el.appendChild(span);
      }
      pos = m.index + run.length;
    }
    if (pos < clean.length) el.appendChild(document.createTextNode(clean.slice(pos)));
    return el;
  };

  B.renderText = function (text, into) {
    into.replaceChildren(...text.split('\n').map((l, i) => B.renderLine(l, i)));
    return into;
  };

  /** Pose (ou remplace) la correction de pinyin du caractère en (ligne, colonne) dans le texte */
  B.setPinyinOverride = function (text, lineIdx, col, py) {
    const lines = text.split('\n');
    const line = lines[lineIdx];
    if (line == null) return text;
    const ch = String.fromCodePoint(line.codePointAt(col));
    let after = line.slice(col + ch.length);
    after = after.replace(/^\[[^\]\n]{1,12}\]/, '');
    lines[lineIdx] = line.slice(0, col) + ch + (py ? '[' + py + ']' : '') + after;
    return lines.join('\n');
  };

  /** Liste des mots chinois présents dans un texte (pour proposer le vocabulaire) */
  B.wordsIn = function (text) {
    const out = [];
    for (const line of text.split('\n')) {
      const { clean } = parseLine(line);
      for (const run of clean.match(/\p{Script=Han}+/gu) || []) out.push(...B.lex.segment(run));
    }
    return out;
  };
})();
