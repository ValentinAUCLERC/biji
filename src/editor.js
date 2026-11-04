/* Biji — page d'un cours : éditeur WYSIWYG (TipTap) avec pinyin, tableaux, dessins, cases 田, repères audio */
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extensions';
import { PinyinDisplay, PinyinFix, refreshPinyin, wordAt } from './zh.js';

const B = window.Biji;
const E = (B.editor = { lesson: null, editor: null, inks: [] });
B.target = null; // champ « caractères » d'un bloc 田 qui a le focus (sinon le pavé écrit dans l'éditeur)
const save = () => E.lesson && B.store.touch(E.lesson);

/* =================== nœuds personnalisés =================== */
function nodeShell(cls, label) {
  const dom = B.h('div', { class: 'nv ' + cls, contenteditable: 'false' });
  const gut = B.h('div.nvgut', B.h('span.nvl', label));
  dom.appendChild(gut);
  return { dom, gut };
}
function delBtn(getPos, editor, node, ask) {
  return B.h('button', { title: 'Supprimer ce bloc', onclick: () => {
    if (ask() && !confirm('Supprimer ce bloc et son contenu ?')) return;
    const p = getPos();
    editor.chain().focus().deleteRange({ from: p, to: p + node().nodeSize }).run();
  } }, '✕');
}

/** Zone de dessin libre (traits stockés dans lesson.inks[id]) */
const InkNode = Node.create({
  name: 'ink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({ id: { default: null }, h: { default: 360 } }),
  parseHTML: () => [{ tag: 'div[data-ink]', getAttrs: (el) => ({ id: el.getAttribute('data-ink'), h: +el.getAttribute('data-h') || 360 }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['div', { 'data-ink': a.id, 'data-h': a.h }],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node;
      const L = E.lesson;
      const id = node.attrs.id;
      if (!L.inks[id]) L.inks[id] = [];
      const { dom, gut } = nodeShell('nv-ink', 'Dessin');
      const cv = B.h('canvas.inkc');
      const grip = B.h('div.grip', { title: 'Glisser pour agrandir' }, '⋯');
      let h = node.attrs.h;
      const setH = (v) => {
        h = v;
        const p = getPos();
        if (typeof p === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(p, 'h', v).setMeta('addToHistory', false));
      };
      const ink = new B.Ink(cv, {
        lw: 1000, lh: () => h, strokes: L.inks[id],
        bg: (ctx, s, w, hh) => {
          ctx.fillStyle = '#d9cfbd';
          const step = 40 * s;
          for (let y = step; y < hh; y += step) for (let x = step; x < w; x += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
        },
        grow: () => { h += 240; },
        onChange: save,
        onStart: () => {},
      });
      ink.o.onStroke = () => { if (h !== cur.attrs.h) setH(h); };
      E.inks.push(ink);
      gut.append(
        B.h('button', { title: 'Annuler le dernier trait', onclick: () => ink.undo() }, '↶'),
        delBtn(getPos, editor, () => cur, () => L.inks[id].length > 0));
      dom.append(cv, grip);
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const y0 = e.clientY, h0 = h;
        const mv = (ev) => { h = Math.max(160, Math.round(h0 + (ev.clientY - y0) / ink.scale)); ink.layout(); };
        const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); setH(h); };
        grip.addEventListener('pointermove', mv);
        grip.addEventListener('pointerup', up);
      });
      return {
        dom,
        update(n) {
          if (n.type !== cur.type || n.attrs.id !== id) return false;
          cur = n;
          if (n.attrs.h !== h) { h = n.attrs.h; ink.layout(); }
          return true;
        },
        stopEvent: (e) => !/^drag|^drop/.test(e.type) && e.target !== dom,
        ignoreMutation: () => true,
        destroy() { ink.destroy(); E.inks = E.inks.filter((i) => i !== ink); },
      };
    };
  },
});

/** Image ou page de PDF annotable : image (magasin d'images) + traits par-dessus (lesson.inks[id]) */
const PicNode = Node.create({
  name: 'pic',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({ id: { default: null }, file: { default: '' }, w: { default: 1000 }, h: { default: 700 }, cap: { default: '' }, text: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-pic]', getAttrs: (el) => ({ id: el.getAttribute('data-ink'), file: el.getAttribute('data-pic'),
    w: +el.getAttribute('data-w') || 1000, h: +el.getAttribute('data-h') || 700, cap: el.getAttribute('data-cap') || '' }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['div', { 'data-pic': a.file, 'data-ink': a.id, 'data-w': a.w, 'data-h': a.h, 'data-cap': a.cap }],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node;
      const L = E.lesson;
      const id = node.attrs.id;
      if (!L.inks[id]) L.inks[id] = [];
      const { dom, gut } = nodeShell('nv-pic', '🖼 ' + (node.attrs.cap || 'Image'));
      const cv = B.h('canvas.inkc.picc');
      const lh = () => (1000 * cur.attrs.h) / cur.attrs.w;
      let img = null, state = 'loading';
      const ink = new B.Ink(cv, {
        lw: 1000, lh, strokes: L.inks[id],
        bg: (ctx, s, w, hh) => {
          if (img) { ctx.drawImage(img, 0, 0, w, hh); return; }
          ctx.fillStyle = '#f3efe6';
          ctx.fillRect(0, 0, w, hh);
          ctx.fillStyle = '#8a8170';
          ctx.font = 15 + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(state === 'loading' ? 'Chargement de l’image…' : 'Image pas encore disponible sur cet appareil (synchro en attente)', w / 2, hh / 2);
        },
        onChange: save,
        onStart: () => {},
      });
      E.inks.push(ink);
      const load = () => B.store.getImage(cur.attrs.file).then(async (b) => {
        if (!b) { state = 'missing'; ink.redraw(); return; }
        try { img = await createImageBitmap(b); } catch (e) { const u = URL.createObjectURL(b); const i = new Image(); i.src = u; await i.decode(); img = i; }
        state = 'ok';
        if (cv.isConnected) ink.redraw();
      }).catch(() => { state = 'missing'; ink.redraw(); });
      load();
      // image arrivée plus tard (synchro) : on réessaie quand on revient sur l'onglet / après une synchro
      const retry = () => { if (state === 'missing') { state = 'loading'; load(); } };
      document.addEventListener('biji:synced', retry);
      gut.append(
        B.h('button', { title: 'Annuler le dernier trait', onclick: () => ink.undo() }, '↶'),
        B.h('button', { title: 'Effacer toutes les annotations de cette image', onclick: () => {
          if (!L.inks[id].length || !confirm('Effacer toutes les annotations de cette image ?')) return;
          L.inks[id].splice(0);
          ink.redraw();
          save();
        } }, 'Tout effacer'),
        delBtn(getPos, editor, () => cur, () => true));
      dom.append(cv);
      return {
        dom,
        update(n) {
          if (n.type !== cur.type || n.attrs.id !== id) return false;
          const fileChanged = n.attrs.file !== cur.attrs.file;
          cur = n;
          if (fileChanged) { img = null; state = 'loading'; load(); }
          ink.layout();
          return true;
        },
        stopEvent: (e) => !/^drag|^drop/.test(e.type) && e.target !== dom,
        ignoreMutation: () => true,
        destroy() { document.removeEventListener('biji:synced', retry); ink.destroy(); E.inks = E.inks.filter((i) => i !== ink); if (img && img.close) img.close(); },
      };
    };
  },
});

/** Insère des images / pages de PDF (fichiers choisis, collés ou déposés) à la position pos (ou au curseur) */
E.insertMedia = async function (files, pos) {
  files = [...files].filter(B.media.isMedia);
  if (!files.length || !E.editor) return false;
  const ed = E.editor;
  const at = pos == null ? null : ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size));
  const pics = await B.media.fromFiles(files);
  if (!pics.length || !E.editor || E.editor !== ed) return false;
  const content = [];
  for (const a of pics) content.push({ type: 'pic', attrs: a });
  content.push({ type: 'paragraph' });
  const chain = ed.chain().focus();
  if (at) chain.insertContentAt(at.depth ? at.after(1) : at.pos, content);
  else chain.insertContent(content);
  chain.scrollIntoView().run();
  return true;
};

/** Cases 田 d'entraînement : modèle + cases (tracés dans lesson.grids[id]) */
const GridNode = Node.create({
  name: 'grid',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: null }, chars: { default: '' }, reps: { default: 7 } }),
  parseHTML: () => [{ tag: 'div[data-grid]', getAttrs: (el) => ({ id: el.getAttribute('data-grid'), chars: el.getAttribute('data-chars') || '', reps: +el.getAttribute('data-reps') || 7 }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['div', { 'data-grid': a.id, 'data-chars': a.chars, 'data-reps': a.reps }],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node;
      const L = E.lesson;
      const id = node.attrs.id;
      if (!L.grids[id]) L.grids[id] = {};
      const cells = L.grids[id];
      const { dom, gut } = nodeShell('nv-grid', '田 Entraînement');
      const inks = [];
      const setAttr = (k, v) => {
        const p = getPos();
        if (typeof p === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(p, k, v));
      };
      const inp = B.h('input.gridchars', { value: node.attrs.chars, placeholder: 'Caractères à pratiquer (ex. 你好)', lang: 'zh-CN', 'aria-label': 'Caractères à pratiquer' });
      const reps = B.h('select', { 'aria-label': 'Nombre de cases' }, ...[4, 7, 10, 14].map((n) => B.h('option', { value: n, selected: n === node.attrs.reps }, n + ' cases')));
      const rows = B.h('div.gridrows');
      gut.append(inp, reps,
        B.h('button', { title: 'Effacer mes tracés', onclick: () => { if (confirm('Effacer tous les tracés de ce bloc ?')) { for (const k in cells) delete cells[k]; save(); draw(); } } }, 'Effacer'),
        delBtn(getPos, editor, () => cur, () => Object.values(cells).some((s) => s.length)));
      dom.append(rows);
      B.ime.attachInput(inp);
      const draw = () => {
        inks.splice(0).forEach((i) => { i.destroy(); E.inks = E.inks.filter((x) => x !== i); });
        const chars = [...new Set([...cur.attrs.chars].filter(B.isHan))];
        rows.replaceChildren(...chars.map((ch) => {
          const py = B.lex.pinyinRun(ch)[0] || '';
          const model = B.h('canvas.cell.model', { title: 'Fiche de ' + ch });
          const row = B.h('div.gridrow', B.h('div.cellwrap', B.h('span.cellpy', { class: 't' + B.toneOf(py) }, py), model));
          const mInk = new B.Ink(model, { lw: 100, lh: () => 100, strokes: [], bg: (ctx, s, w, hh) => { B.bgTian(ctx, s, w, hh); paintModel(ctx, ch, w, '#1f1d1a', 0.9); } });
          model.style.pointerEvents = 'none';
          inks.push(mInk);
          row.firstChild.addEventListener('click', () => B.card.open(ch, {}));
          for (let i = 0; i < cur.attrs.reps; i++) {
            const key = ch + ':' + i;
            if (!cells[key]) cells[key] = [];
            const cv = B.h('canvas.cell');
            row.appendChild(B.h('div.cellwrap', cv));
            const ghost = i < 2 ? 0.18 : i < 3 ? 0.08 : 0;
            inks.push(new B.Ink(cv, {
              lw: 100, lh: () => 100, strokes: cells[key], penScale: 1.4,
              bg: (ctx, s, w, hh) => { B.bgTian(ctx, s, w, hh); if (ghost) paintModel(ctx, ch, w, '#1f1d1a', ghost); },
              onChange: save,
            }));
          }
          return row;
        }));
        E.inks.push(...inks);
        if (!chars.length) rows.appendChild(B.h('p.hint', 'Taper (ou écrire au pavé 手写) les caractères à pratiquer : modèle à gauche, puis des cases à remplir, les premières avec le modèle en transparence.'));
      };
      inp.addEventListener('input', B.debounce(() => setAttr('chars', inp.value.trim()), 500));
      inp.addEventListener('focus', () => { B.target = { input: inp }; });
      inp.addEventListener('blur', () => setTimeout(() => { if (B.target && B.target.input === inp && document.activeElement !== inp && !B.pad.open) B.target = null; }, 200));
      reps.addEventListener('change', () => setAttr('reps', +reps.value));
      draw();
      return {
        dom,
        update(n) {
          if (n.type !== cur.type || n.attrs.id !== id) return false;
          const changed = n.attrs.chars !== cur.attrs.chars || n.attrs.reps !== cur.attrs.reps;
          cur = n;
          if (document.activeElement !== inp) inp.value = n.attrs.chars;
          reps.value = n.attrs.reps;
          if (changed) draw();
          return true;
        },
        stopEvent: (e) => !/^drag|^drop/.test(e.type) && e.target !== dom,
        ignoreMutation: () => true,
        destroy() { inks.forEach((i) => i.destroy()); E.inks = E.inks.filter((x) => !inks.includes(x)); },
      };
    };
  },
});
function paintModel(ctx, ch, w, color, alpha) {
  const data = B.strokeDataSync(ch);
  if (data) {
    ctx.save();
    ctx.globalAlpha = alpha;
    B.drawModel(ctx, data, w * 0.06, w * 0.06, w * 0.88, color);
    ctx.restore();
    return;
  }
  B.strokeData(ch).then(() => E.inks.forEach((i) => { if (i.c.isConnected) i.redraw(); })).catch(() => {});
}

/** Repère audio ▶ 12:34 (inline) : réécouter l'enregistrement à cet instant */
const StampNode = Node.create({
  name: 'stamp',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ rec: { default: '' }, t: { default: 0 } }),
  parseHTML: () => [{ tag: 'button[data-stamp]', getAttrs: (el) => ({ rec: el.getAttribute('data-stamp'), t: +el.getAttribute('data-t') || 0 }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['button', mergeAttributes({ 'data-stamp': a.rec, 'data-t': a.t, class: 'stamp', contenteditable: 'false', title: 'Réécouter ce passage' }), '▶ ' + B.fmtTime(a.t)],
});

/* =================== migration des cours V1 (blocs) =================== */
function migrate(l) {
  if (l.doc) return l;
  const content = [];
  l.inks = l.inks || {};
  l.grids = l.grids || {};
  let list = null;
  const OVR = /(\p{Script=Han})\[([A-Za-zÀ-ɏü:1-5 ]{1,12})\]/gu;
  const inline = (s) => {
    const out = [];
    let last = 0, m;
    OVR.lastIndex = 0;
    while ((m = OVR.exec(s))) {
      if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
      const py = /\d/.test(m[2]) ? B.numToMarks(m[2].trim()) : m[2].trim();
      out.push({ type: 'text', text: m[1], marks: [{ type: 'py', attrs: { py } }] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
    return out;
  };
  for (const b of l.blocks || []) {
    if (b.type === 'text') {
      for (const line of (b.text || '').split('\n')) {
        const hm = line.match(/^(#{1,3})\s+(.*)$/);
        const lm = line.match(/^\s*[-•*]\s+(.*)$/);
        if (lm) {
          if (!list) content.push((list = { type: 'bulletList', content: [] }));
          list.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(lm[1]) }] });
          continue;
        }
        list = null;
        if (hm) content.push({ type: 'heading', attrs: { level: Math.min(3, hm[1].length) }, content: inline(hm[2]) });
        else content.push({ type: 'paragraph', content: line ? inline(line) : undefined });
      }
    } else if (b.type === 'ink') {
      list = null;
      l.inks[b.id] = b.strokes || [];
      content.push({ type: 'ink', attrs: { id: b.id, h: b.h || 360 } });
    } else if (b.type === 'grid') {
      list = null;
      l.grids[b.id] = b.cells || {};
      content.push({ type: 'grid', attrs: { id: b.id, chars: b.chars || '', reps: b.reps || 7 } });
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  l.doc = { type: 'doc', content };
  l.v = 2;
  delete l.blocks;
  l.recordings = l.recordings || [];
  B.store.touch(l);
  return l;
}
B.migrateLesson = migrate;

/* =================== page du cours =================== */
E.open = function (lesson) {
  E.close();
  migrate(lesson);
  cleanOrphans(lesson);
  lesson.inks = lesson.inks || {};
  lesson.grids = lesson.grids || {};
  lesson.recordings = lesson.recordings || [];
  E.lesson = lesson;
  B.target = null;
  const page = B.$('#page');
  const docEl = B.h('div#doc', { lang: 'zh-CN' });
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
    B.h('section#recs'),
    docEl,
    B.h('section#vocab'));
  B.$('#fmtslot').replaceChildren(fmtBar());
  const ed = (E.editor = new Editor({
    element: docEl,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true }, heading: { levels: [1, 2, 3] } }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
      TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: ({ node }) => node.type.name === 'paragraph' ? 'Écrire ici… Maj seule : basculer pinyin→汉字 / clavier français. « ni3 » → « nǐ ».' : '' }),
      PinyinFix, PinyinDisplay, InkNode, PicNode, GridNode, StampNode,
    ],
    content: lesson.doc,
    editorProps: {
      attributes: { class: 'zh-doc', spellcheck: 'false' },
      handleKeyDown: (view, e) => B.ime.handleKey(e, imeAdapter),
      handleTextInput: (view, from, to, text) => toneInput(view, from, to, text),
      // coller une capture / déposer une photo ou un PDF -> bloc image annotable
      handlePaste: (view, e) => {
        const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(B.media.isMedia);
        if (!files.length) return false;
        e.preventDefault();
        E.insertMedia(files);
        return true;
      },
      handleDrop: (view, e, slice, moved) => {
        if (moved) return false;
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(B.media.isMedia);
        if (!files.length) return false;
        e.preventDefault();
        const r = view.posAtCoords({ left: e.clientX, top: e.clientY });
        E.insertMedia(files, r ? r.pos : null);
        return true;
      },
      handleDOMEvents: {
        blur: () => { B.ime.cancel(); return false; },
        focus: () => { B.target = null; return false; },
      },
    },
    onUpdate: () => { save(); E.vocabSoon(); hideBubble(); },
    onSelectionUpdate: () => selectionChanged(),
    onTransaction: () => refreshBar(),
  }));
  docEl.addEventListener('click', onDocClick);
  E.renderRecs();
  E.renderVocab();
  refreshBar();
  if (B.docText(lesson.doc).trim() === '' && !lesson.doc.content.some((n) => n.type !== 'paragraph')) setTimeout(() => ed.commands.focus('end'), 50);
};
E.close = function () {
  hideBubble();
  if (E.editor) { E.syncDoc(); E.editor.destroy(); E.editor = null; }
  E.inks.forEach((i) => i.destroy());
  E.inks = [];
  E.lesson = null;
  const slot = B.$('#fmtslot');
  if (slot) slot.replaceChildren();
};
/** Recopie le document de l'éditeur dans le cours (avant écriture sur disque) + ménage des dessins supprimés */
E.syncDoc = function () {
  if (!E.editor || !E.lesson || E.editor.isDestroyed) return;
  E.lesson.doc = E.editor.getJSON();
};
function cleanOrphans(l) {
  const used = new Set();
  const walk = (n) => { if (n.attrs && n.attrs.id && (n.type === 'ink' || n.type === 'grid' || n.type === 'pic')) used.add(n.attrs.id); (n.content || []).forEach(walk); };
  walk(l.doc);
  for (const k of Object.keys(l.inks || {})) if (!used.has(k)) delete l.inks[k];
  for (const k of Object.keys(l.grids || {})) if (!used.has(k)) delete l.grids[k];
}
B.cleanOrphans = cleanOrphans;

/* ---------- IME + conversion « ni3 » -> « nǐ » ---------- */
const imeAdapter = {
  insert(t) {
    const ed = E.editor;
    ed.view.dispatch(ed.state.tr.insertText(t).scrollIntoView());
  },
  rect() {
    const v = E.editor.view;
    try { return v.coordsAtPos(v.state.selection.from); } catch (e) { return v.dom.getBoundingClientRect(); }
  },
  before() {
    const $f = E.editor.state.selection.$from;
    return $f.parent.textBetween(Math.max(0, $f.parentOffset - 10), $f.parentOffset, null, '\ufffc');
  },
};
function toneInput(view, from, to, text) {
  if (!B.settings.toneConv || !/^[1-5]$/.test(text) || from !== to) return false;
  const $f = view.state.doc.resolve(from);
  const before = $f.parent.textBetween(Math.max(0, $f.parentOffset - 8), $f.parentOffset, null, '\ufffc');
  const conv = B.convertTypedTone(before + text);
  if (!conv) return false;
  view.dispatch(view.state.tr.insertText(conv.text, from - (conv.len - 1), to));
  return true;
}
B.ime.canToggle = (t) => !!(t && t.closest && (t.closest('.ProseMirror') || t.closest('[data-ime]')));

/** Insertion depuis le pavé d'écriture (sans voler le focus : pas de clavier virtuel qui surgit) */
B.insertText = function (text, backspace) {
  if (!E.lesson || !E.editor) return B.toast('Ouvrir un cours d’abord');
  const t = B.target;
  if (t && t.input && document.contains(t.input)) {
    const inp = t.input;
    let s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
    if (backspace) { if (s === e && s > 0) s -= /[\uDC00-\uDFFF]/.test(inp.value[s - 1]) ? 2 : 1; inp.setRangeText('', s, e, 'end'); }
    else if (text !== '\n') inp.setRangeText(text, s, e, 'end');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const ed = E.editor;
  if (backspace) {
    const { $from, empty } = ed.state.selection;
    if (!empty) ed.commands.deleteSelection();
    else if ($from.parentOffset > 0) {
      const prev = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, null, '\ufffc');
      const n = /[\uDC00-\uDFFF]$/.test(prev) ? 2 : 1;
      ed.view.dispatch(ed.state.tr.delete($from.pos - n, $from.pos));
    } else ed.commands.joinBackward();
  } else if (text === '\n') {
    ed.commands.first(({ commands }) => [() => commands.splitListItem('listItem'), () => commands.splitBlock()]);
  } else {
    ed.view.dispatch(ed.state.tr.insertText(text).scrollIntoView());
  }
};

/* ---------- barre de mise en forme ---------- */
const COLORS = [['#c8382b', 'Rouge'], ['#2b5fc4', 'Bleu'], ['#2c8a3e', 'Vert'], ['#8a3fb0', 'Violet']];
const HLS = [['#ffe680', 'Jaune'], ['#c8f0c0', 'Vert'], ['#ffd0dc', 'Rose'], ['#cfe3ff', 'Bleu']];
function fmtBar() {
  const c = (cmd) => () => { cmd(E.editor.chain().focus()).run(); };
  const btn = (label, title, cmd, key, extra = {}) => B.h('button', Object.assign({ title, 'data-k': key || null, onclick: c(cmd) }, extra), label);
  const menu = (label, title, items) => {
    const pop = B.h('div.pop', { hidden: true }, ...items);
    const b = B.h('button.dd', { title, onclick: (e) => { e.stopPropagation(); B.$$('.fmtbar .pop').forEach((p) => p !== pop && (p.hidden = true)); pop.hidden = !pop.hidden; } }, label);
    pop.addEventListener('click', () => (pop.hidden = true));
    return B.h('span.ddwrap', b, pop);
  };
  document.addEventListener('click', () => B.$$('.fmtbar .pop').forEach((p) => (p.hidden = true)));
  const bar = B.h('div.fmtbar', { role: 'toolbar', 'aria-label': 'Mise en forme' },
    B.h('button.ime', { 'data-act': 'ime', title: 'Saisie pinyin → 汉字 (Maj seule pour basculer). Taper « nihao » puis Espace → 你好', onclick: () => { B.ime.toggle(); E.editor && E.editor.commands.focus(); } }, B.ime.on ? '中 pinyin→汉字' : 'FR clavier'),
    B.h('span.sep'),
    btn(B.h('b', 'G'), 'Gras (Ctrl+B)', (x) => x.toggleBold(), 'bold'),
    btn(B.h('i', 'I'), 'Italique (Ctrl+I)', (x) => x.toggleItalic(), 'italic'),
    btn(B.h('u', 'S'), 'Souligné (Ctrl+U)', (x) => x.toggleUnderline(), 'underline'),
    btn(B.h('s', 'B'), 'Barré', (x) => x.toggleStrike(), 'strike'),
    menu(B.h('span', 'A', B.h('span.cbar')), 'Couleur du texte',
      [B.h('button', { onclick: () => E.editor.chain().focus().unsetColor().run() }, B.h('span.sw', { style: 'background:#1f1d1a' }), 'Noir'),
        ...COLORS.map(([col, n]) => B.h('button', { onclick: () => E.editor.chain().focus().setColor(col).run() }, B.h('span.sw', { style: 'background:' + col }), n))]),
    menu(B.h('span.hlic', '▌'), 'Surligner',
      [...HLS.map(([col, n]) => B.h('button', { onclick: () => E.editor.chain().focus().toggleHighlight({ color: col }).run() }, B.h('span.sw', { style: 'background:' + col }), n)),
        B.h('button', { onclick: () => E.editor.chain().focus().unsetHighlight().run() }, 'Aucun')]),
    B.h('span.sep'),
    btn('T1', 'Grand titre', (x) => x.toggleHeading({ level: 1 }), 'h1'),
    btn('T2', 'Sous-titre', (x) => x.toggleHeading({ level: 2 }), 'h2'),
    btn('•', 'Liste à puces (ou taper « - »)', (x) => x.toggleBulletList(), 'bulletList'),
    btn('1.', 'Liste numérotée (ou taper « 1. »)', (x) => x.toggleOrderedList(), 'orderedList'),
    btn('❝', 'Encadré', (x) => x.toggleBlockquote(), 'blockquote'),
    B.h('span.sep'),
    menu('⊞ Tableau', 'Tableau', [
      B.h('button', { onclick: () => E.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }, 'Insérer 3 × 3'),
      B.h('button', { onclick: () => E.editor.chain().focus().insertTable({ rows: 5, cols: 4, withHeaderRow: true }).run() }, 'Insérer 5 × 4 (vocabulaire : 汉字 / pinyin / sens / exemple)')]),
    btn('✏ Dessin', 'Zone de dessin au stylet', (x) => x.insertContent([{ type: 'ink', attrs: { id: 'i' + B.uid(), h: 360 } }, { type: 'paragraph' }])),
    menu('🖼 Image / PDF', 'Image ou PDF à annoter au stylet', [
      B.h('button', { onclick: () => pickMedia(false) }, 'Depuis un fichier (image ou PDF)…'),
      B.h('button', { onclick: () => pickMedia(true) }, '📷 Prendre en photo'),
      B.h('p.pophint', 'Ou coller une capture (Ctrl+V) / glisser-déposer un fichier dans la page')]),
    btn('田 Cases', 'Cases d’entraînement à l’écriture', (x) => x.insertContent([{ type: 'grid', attrs: { id: 'g' + B.uid(), chars: selectedHan(), reps: 7 } }, { type: 'paragraph' }])),
    B.h('button', { 'data-act': 'stamp', hidden: B.rec.state === 'idle', title: 'Repère audio : réécouter plus tard ce passage (Alt+M)', onclick: () => E.insertStamp() }, '⏱ Repère'),
    B.h('span.grow'),
    btn('↶', 'Annuler (Ctrl+Z)', (x) => x.undo()),
    btn('↷', 'Rétablir (Ctrl+Y)', (x) => x.redo()),
    B.h('div.tblbar', { hidden: true },
      B.h('span.lbl', 'Tableau :'),
      btn('+ ligne', 'Ajouter une ligne dessous', (x) => x.addRowAfter()),
      btn('+ colonne', 'Ajouter une colonne à droite', (x) => x.addColumnAfter()),
      btn('− ligne', 'Supprimer la ligne', (x) => x.deleteRow()),
      btn('− colonne', 'Supprimer la colonne', (x) => x.deleteColumn()),
      btn('En-tête', 'Ligne d’en-tête', (x) => x.toggleHeaderRow()),
      btn('Fusionner', 'Fusionner / séparer les cellules sélectionnées', (x) => x.mergeOrSplit()),
      btn('Supprimer le tableau', 'Supprimer le tableau', (x) => x.deleteTable(), null, { class: 'danger' })));
  // les boutons ne prennent pas le focus : le curseur reste dans le texte
  bar.addEventListener('mousedown', (e) => { if (!e.target.closest('input,select')) e.preventDefault(); });
  return bar;
}
function pickMedia(camera) {
  const inp = B.h('input', { type: 'file', accept: camera ? 'image/*' : 'image/*,application/pdf,.pdf', multiple: !camera, capture: camera ? 'environment' : null, hidden: true });
  inp.addEventListener('change', () => { if (inp.files.length) E.insertMedia(inp.files); inp.remove(); });
  document.body.appendChild(inp);
  inp.click();
}
function selectedHan() {
  const ed = E.editor;
  if (!ed) return '';
  const { from, to } = ed.state.selection;
  return [...new Set([...ed.state.doc.textBetween(from, to, '')].filter(B.isHan))].join('');
}
function refreshBar() {
  const ed = E.editor;
  if (!ed || ed.isDestroyed) return;
  B.$$('.fmtbar [data-k]').forEach((b) => {
    const k = b.dataset.k;
    const on = k === 'h1' ? ed.isActive('heading', { level: 1 }) : k === 'h2' ? ed.isActive('heading', { level: 2 }) : ed.isActive(k);
    b.classList.toggle('on', on);
  });
  const tb = B.$('.fmtbar .tblbar');
  if (tb) tb.hidden = !ed.isActive('table');
  const cb = B.$('.fmtbar .cbar');
  if (cb) cb.style.background = ed.getAttributes('textStyle').color || '#1f1d1a';
}

/* ---------- bulle contextuelle : mot sous le curseur / sélection ---------- */
let bubble = null;
function ensureBubble() {
  if (bubble) return bubble;
  bubble = B.h('div#bubble', { hidden: true, role: 'dialog' });
  bubble.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  document.body.appendChild(bubble);
  window.addEventListener('scroll', hideBubble, true);
  return bubble;
}
function hideBubble() { if (bubble) bubble.hidden = true; }
function placeBubble(rect) {
  bubble.hidden = false;
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  let x = Math.min(Math.max(8, rect.left + rect.width / 2 - bw / 2), window.innerWidth - bw - 8);
  let y = rect.bottom + 8;
  if (y + bh > window.innerHeight - 8) y = rect.top - bh - 8;
  bubble.style.left = x + 'px';
  bubble.style.top = Math.max(8, y) + 'px';
}
function pyEl(py) {
  return B.h('span.py', ...py.split(' ').map((s, i) => [i ? ' ' : '', B.h('span', { class: 't' + B.toneOf(s) }, s)]));
}
function vocabBtn(word, py) {
  const has = E.lesson.vocab.some((v) => v.hz === word);
  return B.h('button', { class: has ? 'done' : 'primary', onclick: (e) => { if (E.addVocab(word, py)) e.currentTarget.textContent = '✓ Vocabulaire'; } }, has ? '✓ Vocabulaire' : '+ Vocabulaire');
}
function setPy(c, py) {
  const ed = E.editor;
  const mark = ed.schema.marks.py;
  const tr = ed.state.tr;
  if (py) tr.addMark(c.from, c.to, mark.create({ py }));
  else tr.removeMark(c.from, c.to, mark);
  ed.view.dispatch(tr);
}
function openCard(info) {
  hideBubble();
  B.card.open(info.word, {
    chars: info.chars,
    setPy: (i, py) => { setPy(info.chars[i], py); info.chars[i].py = py || B.lex.pinyinRun(info.chars[i].ch)[0]; },
  });
}
function wordBubble(el) {
  const ed = E.editor;
  const info = wordAt(ed.view, el);
  if (!info) return;
  ensureBubble();
  const py = info.chars.map((c) => c.py).join(' ');
  const e = B.lex.ready ? B.lex.bestReading(info.word, py).entry : null;
  bubble.dataset.mode = 'word';
  bubble.replaceChildren(
    B.h('div.bw', B.h('span.bhz', { lang: 'zh-CN' }, info.word), pyEl(py),
      B.h('button.icon', { title: 'Écouter', onclick: () => B.voice.speak(info.word) }, '🔊')),
    B.h('div.bg', e ? B.lex.gloss(e, 3) : B.lex.ready ? 'Absent du dictionnaire' : 'Dictionnaire en chargement…'),
    B.h('div.bb', B.h('button', { onclick: () => openCard(info) }, 'Fiche et traits'), vocabBtn(info.word, py)));
  const r1 = ed.view.coordsAtPos(info.from), r2 = ed.view.coordsAtPos(info.to);
  placeBubble({ left: r1.left, width: r2.right - r1.left, top: r1.top - 14, bottom: r1.bottom });
}
function selectionChanged() {
  const ed = E.editor;
  const { from, to, empty } = ed.state.selection;
  if (empty || ed.state.selection.node) { if (bubble && bubble.dataset.mode === 'sel') hideBubble(); return; }
  const text = ed.state.doc.textBetween(from, to, ' ', '').trim();
  if (!text || text.length > 60) return hideBubble();
  clearTimeout(selectionChanged.t);
  selectionChanged.t = setTimeout(() => selBubble(from, to, text), 180);
}
function selBubble(from, to, text) {
  const ed = E.editor;
  if (!ed || ed.state.selection.from !== from || ed.state.selection.to !== to) return;
  ensureBubble();
  bubble.dataset.mode = 'sel';
  const replace = (t) => { ed.chain().focus().insertContentAt({ from, to }, t).run(); hideBubble(); };
  if (B.hasHan(text)) {
    const word = [...text].filter(B.isHan).join('');
    const py = B.lex.pinyinRun(word).join(' ');
    bubble.replaceChildren(
      B.h('div.bw', B.h('span.bhz', { lang: 'zh-CN' }, word), pyEl(py), B.h('button.icon', { title: 'Écouter', onclick: () => B.voice.speak(word) }, '🔊')),
      B.h('div.bb',
        B.h('button', { onclick: () => { hideBubble(); B.card.open(word, {}); } }, 'Fiche'),
        vocabBtn(word, py),
        B.h('button', { title: 'Remplacer les caractères par leur pinyin', onclick: () => replace(B.lex.pinyinRun(text).join(' ').replace(/\s+([，。？！、])/g, '$1')) }, '→ pīnyīn')));
  } else if (/^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ1-5'\s-]+$/.test(text)) {
    if (!B.lex.ready) { B.lex.load(); return; }
    pinyinBubble(text, replace);
  } else return hideBubble();
  const r1 = ed.view.coordsAtPos(from), r2 = ed.view.coordsAtPos(to);
  placeBubble({ left: Math.min(r1.left, r2.left), width: Math.abs(r2.right - r1.left), top: r1.top - 14, bottom: r2.bottom });
}
/** Bulle sur du pinyin sélectionné : l'écouter (même sans caractère), puis le remplacer par des hanzi qui se lisent exactement ainsi */
function pinyinBubble(text, replace) {
  const I = B.ime;
  const r = I.syllabify(text);
  const listen = (txt, slow) => B.h('button.icon', { title: slow ? 'Écouter lentement' : 'Écouter', onclick: () => B.voice.speak(txt, slow) }, slow ? '🐢' : '🔊');
  const candBtn = (c) => B.h('button.ic', { lang: 'zh-CN', title: c.py, onclick: () => replace(c.w) },
    B.h('span.w', c.w), pyEl(c.py), B.h('span.g', c.e ? B.lex.shortGloss(c.w, c.e) : ''));
  if (r.bad) {
    // pas du pinyin : « rō » (transcription à la française) -> syllabes réelles proches, à écouter
    const plain = B.plainSyl(r.bad).replace(/ü/g, 'v').replace(/[^a-z]/g, '');
    const t = [...r.bad.normalize('NFC')].map((c) => (B.plainSyl(c) !== c.toLowerCase() ? B.toneOf(c) : 0)).find((x) => x) || +(r.bad.match(/[1-5]$/) || [0, 0])[1];
    const near = I.nearSyllables(plain).map((s) => ({ s, rep: B.lex.charFor(s, t) })).filter((x) => x.rep);
    bubble.replaceChildren(
      B.h('div.bt', '« ' + r.bad + ' » n’est pas une syllabe du chinois : aucun caractère ne se lit ainsi.'),
      near.length ? B.h('div.bt', 'Syllabes proches, cliquer pour écouter :') : null,
      B.h('div.bc', ...near.map(({ rep }) => B.h('button.ic.near', { title: 'Écouter ' + rep.ch + ' (' + rep.py + ')', onclick: () => B.voice.speak(rep.ch) },
        pyEl(rep.py), B.h('span.g', '🔊 ' + rep.ch)))));
    return;
  }
  const syls = r.syls;
  const shown = syls.map((x) => (x.t ? B.markSyllable(x.s.replace(/v/g, 'ü'), x.t) : x.s.replace(/v/g, 'ü'))).join(' ');
  const { toned, exact, other } = I.readingCands(syls);
  const snd = I.soundFor(syls, exact);
  bubble.replaceChildren(...[
    B.h('div.bw', B.h('span.pybig', pyEl(shown)), snd ? listen(snd.text) : null, snd ? listen(snd.text, true) : null),
    snd ? B.h('div.bt', 'La voix lit ' + snd.text + (snd.approx ? ' (aucun caractère courant avec exactement ce ton : son le plus proche)' : '')) : null,
    exact.length
      ? [B.h('div.bt', (toned ? 'Se lit exactement « ' + shown + ' »' : 'Se lit « ' + shown + ' » (sans ton précisé)') + ' : choisir pour remplacer'),
        B.h('div.bc', ...exact.map(candBtn))]
      : B.h('div.bt', 'Aucun mot ne se lit exactement « ' + shown + ' ».'),
    other.length ? [B.h('div.bt.other', 'Même son, autre ton :'), B.h('div.bc.other', ...other.map(candBtn))] : null].flat());
}

function onDocClick(e) {
  const st = e.target.closest('.stamp');
  if (st) { e.preventDefault(); B.rec.playAt(st.dataset.stamp, +st.dataset.t); return; }
  const hz = e.target.closest('.hz');
  if (hz && E.editor.state.selection.empty) { wordBubble(hz); return; }
  if (bubble && bubble.dataset.mode === 'word') hideBubble();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBubble(); });

/* ---------- enregistrements du cours ---------- */
E.insertStamp = function (auto) {
  const r = B.rec.cur && B.rec.cur();
  if (!r || !E.editor || r.lessonId !== E.lesson.id) return auto ? null : B.toast('Pas d’enregistrement en cours pour ce cours');
  const t = Math.round(B.rec.elapsed());
  const ed = E.editor;
  if (auto) ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph', content: [{ type: 'stamp', attrs: { rec: r.id, t } }, { type: 'text', text: ' début de l’enregistrement' }] }).run();
  else {
    // focus() de TipTap restaure la sélection au prochain rAF : à éviter si l'éditeur a déjà le focus (sinon la frappe rapide est écrasée)
    const c = ed.isFocused ? ed.chain() : ed.chain().focus();
    c.insertContent([{ type: 'stamp', attrs: { rec: r.id, t } }, { type: 'text', text: ' ' }]).run();
  }
};
E.renderRecs = function () {
  const sec = B.$('#recs');
  if (!sec || !E.lesson) return;
  const L = E.lesson;
  if (!L.recordings.length) { sec.replaceChildren(); sec.hidden = true; return; }
  sec.hidden = false;
  sec.replaceChildren(B.h('h3', 'Enregistrements'), ...L.recordings.map((r) => {
    const audio = B.h('audio', { controls: true, preload: 'metadata', 'data-rec': r.id, 'data-file': r.file });
    B.rec.url(r).then((u) => { if (u) audio.src = u; else audio.replaceWith(B.h('span.hint', 'Fichier absent de ce navigateur : connecter le dossier des notes (audio/' + r.file + ')')); });
    const when = new Date(r.startedAt);
    return B.h('div.recrow',
      B.h('input.rtitle', { value: r.title, 'aria-label': 'Nom de l’enregistrement', onchange: (e) => { r.title = e.target.value; save(); } }),
      B.h('span.rmeta', when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + B.fmtTime(r.dur || 0)),
      audio,
      B.h('select.rate', { title: 'Vitesse de lecture', onchange: (e) => { audio.playbackRate = +e.target.value; } },
        ...[0.75, 1, 1.25, 1.5].map((v) => B.h('option', { value: v, selected: v === 1 }, '×' + v))),
      B.h('button.icon', { title: 'Télécharger', onclick: async () => {
        const u = await B.rec.url(r);
        if (!u) return B.toast('Fichier introuvable');
        B.h('a', { href: u, download: r.file }).click();
      } }, '⤓'),
      B.h('button.icon', { title: 'Supprimer l’enregistrement', onclick: async () => {
        if (!confirm('Supprimer définitivement « ' + r.title + ' » ?')) return;
        L.recordings.splice(L.recordings.indexOf(r), 1);
        save();
        await B.store.deleteAudio(r);
        E.renderRecs();
      } }, '✕'));
  }));
};
document.addEventListener('biji:recordings', (e) => { if (E.lesson && E.lesson.id === e.detail) E.renderRecs(); });

/* ---------- vocabulaire du cours ---------- */
E.vocabSoon = B.debounce(() => E.renderVocab(), 900);
E.addVocab = function (word, py, fr) {
  const L = E.lesson;
  if (!L) return false;
  if (L.vocab.some((v) => v.hz === word)) { B.toast('« ' + word + ' » est déjà dans le vocabulaire'); return false; }
  const r = B.lex.bestReading(word, py);
  L.vocab.push({ id: 'v' + B.uid(), hz: word, py: py || r.py, fr: fr != null ? fr : B.lex.gloss(r.entry), box: 0, due: 0, added: Date.now() });
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
  const text = E.editor ? E.editor.state.doc.textBetween(0, E.editor.state.doc.content.size, '\n', ' ') : B.docText(L.doc);
  for (const w of B.wordsIn(text)) {
    if (known.has(w) || seen.has(w)) continue;
    seen.add(w);
    if (B.lex.ready && B.lex.lookup(w).length) found.push(w);
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
      : B.h('p.hint', 'Cliquer sur un mot chinois dans les notes puis « + Vocabulaire », ou piocher dans les mots repérés ci-dessous.'),
    found.length
      ? B.h('div.found', B.h('span.lbl', 'Repérés dans les notes :'),
        ...found.slice(0, 80).map((w) => B.h('button.chip', { lang: 'zh-CN', title: 'Ajouter ' + w + ' (' + B.lex.shortGloss(w) + ')', onclick: () => E.addVocab(w) }, '+ ' + w)))
      : null);
};

document.addEventListener('biji:dict', () => {
  if (!E.editor) return;
  refreshPinyin(E.editor);
  E.renderVocab();
});
