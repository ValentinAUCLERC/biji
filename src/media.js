/* Biji — images et PDF annotables : préparation des images (réduction, orientation), rendu des pages de PDF.
 * Les fichiers vont dans le magasin d'images (IndexedDB + dossier images/ + Drive Biji/images), jamais dans le JSON du cours.
 */
(function () {
  const B = window.Biji;
  const M = (B.media = {});
  const MAX = 2000; // plus grand côté d'une photo / capture (px)
  const PDF_W = 1600; // largeur de rendu d'une page de PDF (px)

  async function decode(blob) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* format non pris en charge par createImageBitmap */ }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  /** Encode un canvas : WebP si le navigateur sait (≈ 2× plus léger), sinon JPEG */
  async function encode(cv) {
    const as = (type, q) => new Promise((r) => cv.toBlob(r, type, q));
    let b = await as('image/webp', 0.82);
    if (!b || b.type !== 'image/webp') b = await as('image/jpeg', 0.85);
    return b;
  }
  const extOf = (b) => (b.type === 'image/webp' ? '.webp' : '.jpg');

  /** Photo / capture -> { file, w, h } enregistrée dans le magasin d'images */
  M.addImage = async function (blob) {
    const src = await decode(blob);
    const sw = src.width, sh = src.height;
    if (!sw || !sh) throw new Error('Image illisible');
    const k = Math.min(1, MAX / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; // captures PNG transparentes : fond blanc
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    const out = await encode(cv);
    const file = 'p' + B.uid() + extOf(out);
    await B.store.saveImage(file, out);
    return { file, w, h };
  };

  /* ---------- PDF (pdf.js chargé au premier besoin) ---------- */
  let pdfjs = null;
  async function loadPdf() {
    if (pdfjs) return pdfjs;
    const base = new URL('vendor/pdfjs/', location.href).href;
    const url = base + 'pdf.min.mjs';
    pdfjs = await import(/* webpackIgnore: true */ url);
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    pdfjs.__base = base;
    return pdfjs;
  }
  M.openPdf = async function (blob) {
    const lib = await loadPdf();
    const base = lib.__base;
    return lib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      cMapUrl: base + 'cmaps/', cMapPacked: true, // PDF chinois sans polices intégrées
      standardFontDataUrl: base + 'standard_fonts/',
      wasmUrl: base + 'wasm/',
      isEvalSupported: false,
    }).promise;
  };
  /** Page n (1…) -> { file, w, h, text } */
  M.pdfPage = async function (pdf, n) {
    const page = await pdf.getPage(n);
    const v0 = page.getViewport({ scale: 1 });
    const scale = Math.min(PDF_W / v0.width, 2600 / v0.height, 4);
    const v = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(v.width);
    cv.height = Math.round(v.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, canvas: cv, viewport: v }).promise;
    let text = '';
    try {
      const tc = await page.getTextContent();
      text = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 6000);
    } catch (e) { /* texte facultatif (recherche) */ }
    page.cleanup();
    const out = await encode(cv);
    const file = 'p' + B.uid() + extOf(out);
    await B.store.saveImage(file, out);
    return { file, w: cv.width, h: cv.height, text };
  };

  const closePdf = (pdf) => { try { (pdf.loadingTask || pdf).destroy(); } catch (e) { /* déjà fermé */ } };

  /** « 1-3, 5, 8-9 » -> [1,2,3,5,8,9] (bornées à 1…max) */
  M.parsePages = function (s, max) {
    const out = new Set();
    for (const part of String(s).split(/[,; ]+/)) {
      const m = /^(\d+)(?:\s*[-–à]\s*(\d+))?$/.exec(part.trim());
      if (!m) continue;
      let a = +m[1], b = m[2] ? +m[2] : a;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(max, b); i++) out.add(i);
    }
    return [...out].sort((x, y) => x - y);
  };

  /** Petite fenêtre « Pages à importer » (renvoie la liste, ou null si annulé) */
  M.askPages = function (name, n) {
    return new Promise((resolve) => {
      const def = n <= 12 ? '1-' + n : '1-12';
      const inp = B.h('input#pdfpages', { value: n === 1 ? '1' : def, 'aria-label': 'Pages à importer', autocomplete: 'off' });
      const err = B.h('p.hint.err', { hidden: true });
      const dlg = B.h('dialog#pdfdlg',
        B.h('form', { method: 'dialog' },
          B.h('h3', 'Importer « ' + name + ' »'),
          B.h('p', n + (n > 1 ? ' pages' : ' page') + '. Chaque page devient un bloc image où dessiner au stylet.'),
          B.h('label', 'Pages à importer ', inp),
          B.h('p.hint', 'Exemples : « 1-' + n + ' » (tout), « 2 », « 1-3, 6 »' + (n > 30 ? ' — beaucoup de pages alourdissent le cours' : '')),
          err,
          B.h('div.row',
            B.h('button.ghost', { value: 'no', type: 'submit' }, 'Annuler'),
            B.h('button.primary#pdfok', { value: 'ok', type: 'submit' }, 'Importer'))));
      dlg.addEventListener('submit', (e) => {
        const ok = e.submitter && e.submitter.value === 'ok';
        if (!ok) return;
        const pages = M.parsePages(inp.value, n);
        if (!pages.length) { e.preventDefault(); err.hidden = false; err.textContent = 'Aucune page valide (entre 1 et ' + n + ').'; }
      });
      dlg.addEventListener('close', () => {
        dlg.remove();
        resolve(dlg.returnValue === 'ok' ? M.parsePages(inp.value, n) : null);
      });
      document.body.appendChild(dlg);
      dlg.showModal();
      inp.select();
    });
  };

  /**
   * Fichiers (images et/ou PDF) -> attributs de blocs « pic » prêts à insérer.
   * onProgress(texte) pour l'affichage.
   */
  M.fromFiles = async function (files) {
    const out = [];
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (isPdf) {
        B.toast('Ouverture du PDF…', 60000);
        let pdf;
        try { pdf = await M.openPdf(f); } catch (e) { B.toast('PDF illisible : ' + e.message, 5000); continue; }
        const name = (f.name || 'document.pdf').replace(/\.pdf$/i, '');
        B.toast('PDF ouvert', 600);
        const pages = await M.askPages(name, pdf.numPages);
        if (!pages) { B.toast('Import annulé', 1500); closePdf(pdf); continue; }
        for (let i = 0; i < pages.length; i++) {
          B.toast('Import du PDF : page ' + (i + 1) + ' / ' + pages.length + '…', 60000);
          const r = await M.pdfPage(pdf, pages[i]);
          out.push({ id: 'i' + B.uid(), file: r.file, w: r.w, h: r.h, cap: name + ' — p. ' + pages[i], text: r.text });
        }
        closePdf(pdf);
      } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i.test(f.name || '')) {
        B.toast('Ajout de l’image…', 60000);
        try {
          const r = await M.addImage(f);
          const cap = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.\w+$/, '') : 'Image';
          out.push({ id: 'i' + B.uid(), file: r.file, w: r.w, h: r.h, cap, text: '' });
        } catch (e) { B.toast('Image illisible (' + (f.name || f.type) + ')', 5000); }
      }
    }
    if (out.length) B.toast(out.length > 1 ? out.length + ' images ajoutées : dessiner dessus au stylet' : 'Image ajoutée : dessiner dessus au stylet', 3000);
    return out;
  };
  M.isMedia = (f) => f && (/^image\//.test(f.type) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
})();
