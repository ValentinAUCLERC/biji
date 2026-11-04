/* Biji — pinyin au-dessus des hanzi DANS l'éditeur (décorations ProseMirror, le texte reste éditable)
 * Chaque caractère chinois reçoit <span class="hz t3" data-py="nǐ" data-w="你好" data-wi="0">.
 * Correction de lecture : marque « py » posée sur le caractère (attribut py).
 */
import { Extension, Mark } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const B = window.Biji;
const HANRUN = /\p{Script=Han}+/gu;
const key = new PluginKey('bijiPinyin');

/** Marque de correction de pinyin (« 行 » lu háng) */
export const PinyinFix = Mark.create({
  name: 'py',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { py: { default: '', parseHTML: (el) => el.getAttribute('data-fix'), renderHTML: (a) => ({ 'data-fix': a.py }) } };
  },
  parseHTML: () => [{ tag: 'span[data-fix]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

/** Analyse d'un bloc de texte : [{from, to, ch, py, w, wi, fixed}] en offsets relatifs au contenu du bloc */
function analyse(node) {
  // texte + offsets ProseMirror (les nœuds inline non texte comptent pour 1)
  let text = '';
  const offs = [];
  const fixes = new Map();
  node.forEach((child, off) => {
    if (child.isText) {
      const fix = child.marks.find((m) => m.type.name === 'py');
      for (let i = 0; i < child.text.length; i++) {
        offs.push(off + i);
        if (fix) fixes.set(text.length + i, fix.attrs.py);
      }
      text += child.text;
    } else {
      offs.push(off);
      text += '\uFFFC';
    }
  });
  const out = [];
  let m;
  HANRUN.lastIndex = 0;
  while ((m = HANRUN.exec(text))) {
    const run = m[0];
    const pys = B.lex.pinyinRun(run);
    let k = 0; // index en unités UTF-16 dans run
    let ci = 0; // index de caractère (pinyinRun : un élément par caractère)
    for (const w of B.lex.segment(run)) {
      let wi = 0;
      for (const ch of w) {
        const at = m.index + k;
        const fixed = fixes.get(at);
        const py = fixed || pys[ci] || '';
        out.push({ from: offs[at], to: offs[at] + ch.length, ch, py, w, wi, fixed: !!fixed });
        k += ch.length;
        ci++;
        wi++;
      }
    }
  }
  return out;
}

const cache = new Map(); // node -> analyse (les nœuds ProseMirror sont immuables)
function decosFor(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!B.HAN.test(node.textContent)) return false;
    let a = cache.get(node);
    if (!a) {
      a = analyse(node);
      cache.set(node, a);
      if (cache.size > 4000) cache.clear();
    }
    for (const c of a) {
      // --L = nombre de lettres : le CSS élargit le caractère selon la taille du pinyin (réglable) pour éviter les chevauchements
      const L = c.py.length;
      decos.push(Decoration.inline(pos + 1 + c.from, pos + 1 + c.to, {
        nodeName: 'span',
        class: 'hz t' + B.toneOf(c.py) + (c.wi === 0 ? ' ws' : '') + (c.wi === [...c.w].length - 1 ? ' we' : '') + (c.fixed ? ' fixed' : ''),
        'data-py': c.py,
        'data-w': c.w,
        'data-wi': String(c.wi),
        style: L > 1 ? `--L:${L}` : null,
      }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export const PinyinDisplay = Extension.create({
  name: 'pinyinDisplay',
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, { doc }) => decosFor(doc),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decosFor(tr.doc) : old),
      },
      props: { decorations: (state) => key.getState(state) },
    })];
  },
});
/** Recalcul forcé (dictionnaire chargé après coup) */
export function refreshPinyin(editor) {
  cache.clear();
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
}

/** Mot sous un élément .hz : {word, from, to, chars:[{ch, py, from, to, fixed}]} */
export function wordAt(view, el) {
  const wi = +el.dataset.wi;
  const w = el.dataset.w;
  const pos = view.posAtDOM(el, 0);
  const $p = view.state.doc.resolve(pos);
  const block = $p.parent;
  const start = $p.start();
  const a = cache.get(block) || analyse(block);
  const idx = a.findIndex((c) => start + c.from === pos);
  if (idx < 0) return null;
  const first = idx - wi;
  const chars = a.slice(first, first + [...w].length).map((c) => ({ ch: c.ch, py: c.py, fixed: c.fixed, from: start + c.from, to: start + c.to }));
  return { word: w, from: chars[0].from, to: chars[chars.length - 1].to, chars };
}

/* ---------- Texte d'un document (JSON TipTap) : recherche, vocabulaire repéré ---------- */
B.docText = function (doc) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text') out.push(n.text);
    if (n.type === 'grid' && n.attrs) out.push(' ' + (n.attrs.chars || '') + ' ');
    (n.content || []).forEach(walk);
    if (n.type && /paragraph|heading|tableCell|tableHeader|listItem/.test(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join('');
};
B.wordsIn = function (text) {
  const out = [];
  for (const run of text.match(HANRUN) || []) out.push(...B.lex.segment(run));
  return out;
};
