/* Biji — surface d'encre (stylet) : pression, gomme (bout gomme ou bouton du stylet), anti-paume, défilement au doigt */
(function () {
  const B = window.Biji;

  B.tool = { kind: 'pen', color: '#1f1d1a', width: 2.6 }; // kind : pen | hl | eraser
  B.penActive = false;
  let lastPen = 0;
  const hoverEraser = new Map(); // pointerId -> le stylet survole avec le bout gomme

  /** Le bout gomme (ou le bouton gomme) est-il utilisé ? Chrome/Edge/Firefox : button 5 au contact, bit 32 dans buttons. */
  B.isEraser = function (e) {
    if (e.pointerType === 'eraser') return true; // anciens navigateurs
    if (e.pointerType !== 'pen') return false;
    return e.button === 5 || (e.buttons & 32) === 32 || hoverEraser.get(e.pointerId) === true;
  };
  function trackHover(e) {
    if (e.pointerType !== 'pen') return;
    if (e.buttons === 0) hoverEraser.delete(e.pointerId);
    if ((e.buttons & 32) === 32 || e.button === 5) hoverEraser.set(e.pointerId, true);
    if (B.penDiag) B.penDiag(e);
  }
  ['pointerover', 'pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'pointerleave'].forEach((t) =>
    document.addEventListener(t, trackHover, true));

  function dist2Seg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
  }

  /** Dessine un trait {k, c, w, p:[[x,y,pression]…]} en coordonnées logiques * scale */
  B.drawStroke = function (ctx, s, scale) {
    const p = s.p;
    if (!p.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = s.c;
    if (s.k === 'hl') {
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = s.w * scale;
      ctx.beginPath();
      ctx.moveTo(p[0][0] * scale, p[0][1] * scale);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * scale, p[i][1] * scale);
      if (p.length === 1) ctx.lineTo(p[0][0] * scale + 0.1, p[0][1] * scale);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const W = (q) => Math.max(0.6, s.w * (0.3 + 1.15 * (q == null ? 0.5 : q)) * scale);
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0] * scale, p[0][1] * scale, W(p[0][2]) / 2, 0, 7);
      ctx.fill();
      ctx.restore();
      return;
    }
    let mx = p[0][0], my = p[0][1];
    for (let i = 1; i < p.length; i++) {
      const nx = i < p.length - 1 ? (p[i][0] + p[i + 1][0]) / 2 : p[i][0];
      const ny = i < p.length - 1 ? (p[i][1] + p[i + 1][1]) / 2 : p[i][1];
      ctx.beginPath();
      ctx.moveTo(mx * scale, my * scale);
      ctx.quadraticCurveTo(p[i][0] * scale, p[i][1] * scale, nx * scale, ny * scale);
      ctx.lineWidth = W(((p[i - 1][2] ?? 0.5) + (p[i][2] ?? 0.5)) / 2);
      ctx.stroke();
      mx = nx;
      my = ny;
    }
    ctx.restore();
  };

  /**
   * new B.Ink(canvas, {
   *   lw, lh: () => hauteur logique, strokes: tableau muté sur place,
   *   bg(ctx, scale, w, h), onChange(), onStroke(stroke), onStart(), fingerDraw: () => bool, grow: () => void
   * })
   */
  class Ink {
    constructor(canvas, o) {
      this.c = canvas;
      this.o = o;
      this.strokes = o.strokes;
      this.hist = [];
      this.cur = null;
      this.ctx = canvas.getContext('2d');
      this.base = document.createElement('canvas');
      this.w = 0;
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => this.down(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', (e) => this.up(e));
      canvas.addEventListener('pointercancel', (e) => this.up(e, true));
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    get scale() { return this.w / this.o.lw; }
    resize(force) {
      const w = this.c.clientWidth;
      if (!w || (w === this.w && !force)) return;
      this.w = w;
      this.layout();
    }
    layout() {
      const dpr = window.devicePixelRatio || 1;
      const h = Math.round(this.o.lh() * this.scale);
      this.h = h;
      if (!this.o.fixedHeight) this.c.style.height = h + 'px';
      for (const cv of [this.c, this.base]) {
        cv.width = Math.round(this.w * dpr);
        cv.height = Math.round(h * dpr);
        cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.redraw();
    }
    redraw() {
      const b = this.base.getContext('2d');
      b.clearRect(0, 0, this.w, this.h);
      if (this.o.bg) this.o.bg(b, this.scale, this.w, this.h);
      for (const s of this.strokes) B.drawStroke(b, s, this.scale);
      this.paint();
    }
    paint() {
      const dpr = window.devicePixelRatio || 1;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.c.width, this.c.height);
      this.ctx.drawImage(this.base, 0, 0);
      this.ctx.restore();
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.cur && this.cur.stroke) B.drawStroke(this.ctx, this.cur.stroke, this.scale);
      if (this.cur && this.cur.erase && this.cur.at) {
        const s = this.scale;
        this.ctx.beginPath();
        this.ctx.arc(this.cur.at[0] * s, this.cur.at[1] * s, 10 * s, 0, 7);
        this.ctx.strokeStyle = '#c8382b88';
        this.ctx.stroke();
      }
    }
    pt(e) {
      const r = this.c.getBoundingClientRect();
      const s = this.scale;
      const pr = e.pointerType === 'pen' ? (e.pressure || 0.2) : 0.5;
      return [Math.round(((e.clientX - r.left) / s) * 10) / 10, Math.round(((e.clientY - r.top) / s) * 10) / 10, Math.round(pr * 100) / 100];
    }
    fingerDraws() { return this.o.fingerDraw ? this.o.fingerDraw() : !!(B.settings && B.settings.fingerDraw); }
    down(e) {
      if (this.cur) return;
      const pen = e.pointerType === 'pen' || e.pointerType === 'eraser';
      if (pen) { lastPen = performance.now(); B.penActive = true; }
      if (e.pointerType === 'touch') {
        if (B.penActive || performance.now() - lastPen < 1200) { e.preventDefault(); return; } // paume posée
        if (!this.fingerDraws()) {
          this.scroll = { id: e.pointerId, y: e.clientY, x: e.clientX };
          try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* idem */ }
          return;
        }
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
      B.lastInk = this;
      const erase = B.tool.kind === 'eraser' || B.isEraser(e);
      this.cur = { id: e.pointerId, erase, before: this.strokes.slice(), removed: false, stroke: erase ? null : this.newStroke() };
      if (this.o.onStart) this.o.onStart();
      this.add(e);
    }
    newStroke() {
      const hl = B.tool.kind === 'hl';
      return { k: hl ? 'hl' : 'pen', c: hl ? (B.tool.hlColor || '#ffd54a') : B.tool.color, w: hl ? 14 : B.tool.width * (this.o.penScale || 1), p: [] };
    }
    add(e) {
      // le bout gomme peut n'être signalé qu'après le contact : on bascule le trait en gomme
      if (!this.cur.erase && B.isEraser(e)) { this.cur.erase = true; this.cur.stroke = null; }
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) {
        const q = this.pt(ev);
        if (this.cur.erase) { this.cur.at = q; this.eraseAt(q); }
        else {
          const p = this.cur.stroke.p;
          const l = p[p.length - 1];
          if (!l || Math.abs(l[0] - q[0]) + Math.abs(l[1] - q[1]) > 0.4) p.push(q);
        }
      }
      if (!this.cur.erase) {
        const y = this.cur.stroke.p.length ? this.cur.stroke.p[this.cur.stroke.p.length - 1][1] : 0;
        if (this.o.grow && y > this.o.lh() - 50) { this.o.grow(); this.layout(); }
      }
      this.paint();
    }
    eraseAt(q) {
      const r2 = 10 * 10;
      let hit = false;
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        const p = this.strokes[i].p;
        let touched = false;
        for (let j = 0; j < p.length && !touched; j++) {
          const a = p[j], b = p[j + 1] || p[j];
          if (dist2Seg(q[0], q[1], a[0], a[1], b[0], b[1]) < r2 + (this.strokes[i].w * this.strokes[i].w) / 4) touched = true;
        }
        if (touched) { this.strokes.splice(i, 1); hit = true; }
      }
      if (hit) { this.cur.removed = true; this.redraw(); }
    }
    move(e) {
      if (this.scroll && e.pointerId === this.scroll.id) {
        const dy = e.clientY - this.scroll.y;
        this.scroll.y = e.clientY;
        (this.o.scroller || document.scrollingElement).scrollBy(0, -dy);
        return;
      }
      if (e.pointerType === 'pen' && !this.cur) lastPen = performance.now();
      if (!this.cur || e.pointerId !== this.cur.id) return;
      e.preventDefault();
      this.add(e);
    }
    up(e, cancel) {
      if (e.pointerType === 'pen' || e.pointerType === 'eraser') { B.penActive = false; lastPen = performance.now(); }
      if (this.scroll && e.pointerId === this.scroll.id) { this.scroll = null; return; }
      if (!this.cur || e.pointerId !== this.cur.id) return;
      const cur = this.cur;
      this.cur = null;
      if (cur.erase) {
        this.paint();
        if (cur.removed) { this.hist.push(cur.before); this.changed(); }
        return;
      }
      if (cancel && cur.stroke.p.length < 3) { this.paint(); return; }
      this.hist.push(cur.before);
      this.strokes.push(cur.stroke);
      B.drawStroke(this.base.getContext('2d'), cur.stroke, this.scale);
      this.paint();
      this.changed();
      if (this.o.onStroke) this.o.onStroke(cur.stroke);
    }
    changed() { if (this.o.onChange) this.o.onChange(); }
    undo() {
      if (!this.hist.length) return false;
      this.strokes.splice(0, this.strokes.length, ...this.hist.pop());
      this.redraw();
      this.changed();
      return true;
    }
    clear() {
      if (!this.strokes.length) return;
      this.hist.push(this.strokes.slice());
      this.strokes.length = 0;
      this.redraw();
      this.changed();
    }
    destroy() { this.ro.disconnect(); }
  }
  B.Ink = Ink;

  /** Fond « case 田 » : bord + croix en pointillés */
  B.bgTian = function (ctx, scale, w, h, color = '#e3a99f') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();
  };
})();
