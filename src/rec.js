/* Biji — enregistrement audio du cours
 * MediaRecorder (Opus/WebM), morceaux sauvés toutes les 5 s (récupérables après un plantage),
 * écran maintenu allumé, repères horodatés insérables dans les notes (▶ 12:34 = réécouter à cet instant).
 */
import fixWebmDuration from 'fix-webm-duration';

(function () {
  const B = window.Biji;
  const R = (B.rec = { state: 'idle' /* idle | rec | paused */ });
  let mr = null, stream = null, cur = null, wake = null, tick = null, chunks = [];
  let elapsedBefore = 0, segStart = 0;

  R.cur = () => cur;
  R.supported = () => !!(navigator.mediaDevices && window.MediaRecorder);
  R.elapsed = () => (R.state === 'rec' ? elapsedBefore + (performance.now() - segStart) : elapsedBefore);
  B.fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };

  function mime() {
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(t)) return t;
    return '';
  }
  async function keepAwake() {
    try { wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && R.state === 'rec' && !wake) keepAwake(); });

  R.start = async function (lesson) {
    if (!R.supported()) return B.toast('Enregistrement impossible dans ce navigateur', 5000);
    if (R.state !== 'idle') return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      return B.toast(e.name === 'NotAllowedError' ? 'Micro refusé : autoriser le micro pour ce site (icône à gauche de l’adresse)' : 'Micro indisponible : ' + e.message, 6000);
    }
    const type = mime();
    mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : {});
    const ext = /mp4/.test(mr.mimeType) ? 'm4a' : /ogg/.test(mr.mimeType) ? 'ogg' : 'webm';
    const n = (lesson.recordings || []).length + 1;
    cur = { id: 'r' + B.uid(), lessonId: lesson.id, file: `${lesson.id}-${n}.${ext}`, title: 'Enregistrement ' + n, startedAt: Date.now(), dur: 0, type: mr.mimeType };
    chunks = [];
    mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      chunks.push(e.data);
      B.store.addChunk(cur.id, cur.lessonId, cur.startedAt, e.data).catch(() => {});
    };
    mr.start(5000);
    elapsedBefore = 0;
    segStart = performance.now();
    R.state = 'rec';
    R.lesson = lesson;
    keepAwake();
    tick = setInterval(R.ui, 500);
    R.ui();
    B.toast('Enregistrement lancé. Bouton ⏱ (Alt+M) : repère dans les notes pour réécouter ce passage');
    if (B.editor && B.editor.insertStamp) B.editor.insertStamp(true);
  };
  R.pause = function () {
    if (R.state === 'rec') { mr.pause(); elapsedBefore = R.elapsed(); R.state = 'paused'; }
    else if (R.state === 'paused') { mr.resume(); segStart = performance.now(); R.state = 'rec'; }
    R.ui();
  };
  R.stop = function () {
    if (R.state === 'idle') return Promise.resolve();
    return new Promise((res) => {
      const dur = R.elapsed();
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(tick);
        if (wake) { wake.release().catch(() => {}); wake = null; }
        let blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (/webm/.test(blob.type)) { try { blob = await fixWebmDuration(blob, dur, { logger: false }); } catch (e) { /* durée absente, lecture quand même possible */ } }
        const rec = Object.assign({}, cur, { dur: Math.round(dur), size: blob.size });
        const lesson = B.store.get(rec.lessonId) || R.lesson;
        lesson.recordings = lesson.recordings || [];
        lesson.recordings.push(rec);
        B.store.touch(lesson);
        const onDisk = await B.store.saveAudio(rec, blob);
        (await B.store.takeChunks(rec.id)).drop();
        R.state = 'idle';
        mr = stream = cur = null;
        chunks = [];
        R.ui();
        B.toast('Enregistrement sauvé (' + B.fmtTime(dur) + (onDisk ? ', dans le dossier audio/' : ', dans le navigateur') + ')', 4000);
        document.dispatchEvent(new CustomEvent('biji:recordings', { detail: lesson.id }));
        res(rec);
      };
      mr.stop();
    });
  };
  window.addEventListener('beforeunload', (e) => { if (R.state !== 'idle') { e.preventDefault(); e.returnValue = ''; } });

  /** Morceaux orphelins (onglet fermé ou plantage pendant un enregistrement) -> on reconstitue */
  R.recover = async function () {
    const { chunks: list, drop } = await B.store.takeChunks();
    if (!list.length || R.state !== 'idle') return;
    const byRec = new Map();
    for (const c of list) { if (!byRec.has(c.recId)) byRec.set(c.recId, []); byRec.get(c.recId).push(c); }
    let n = 0;
    for (const [recId, cs] of byRec) {
      const lesson = B.store.get(cs[0].lessonId);
      if (!lesson) continue;
      const blob = new Blob(cs.map((c) => c.blob), { type: cs[0].blob.type || 'audio/webm' });
      const dur = cs[cs.length - 1].at - cs[0].startedAt;
      const k = (lesson.recordings || []).length + 1;
      const rec = { id: recId, lessonId: lesson.id, file: `${lesson.id}-${k}-recupere.webm`, title: 'Enregistrement ' + k + ' (récupéré)', startedAt: cs[0].startedAt, dur, size: blob.size, type: blob.type };
      lesson.recordings = (lesson.recordings || []).concat([rec]);
      B.store.touch(lesson);
      await B.store.saveAudio(rec, blob);
      n++;
    }
    await drop();
    if (n) B.toast(n + ' enregistrement(s) interrompu(s) récupéré(s)', 5000);
  };

  /* ---------- lecture ---------- */
  const urls = new Map();
  R.url = async function (rec) {
    if (urls.has(rec.id)) return urls.get(rec.id);
    const b = await B.store.getAudio(rec);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(rec.id, u);
    return u;
  };
  /** Lit l'enregistrement recId à partir de t (ms) dans le lecteur du cours */
  R.playAt = async function (recId, t) {
    const audio = B.$('audio[data-rec="' + recId + '"]');
    if (!audio) return B.toast('Enregistrement introuvable dans ce cours');
    if (!audio.src) { const u = await R.url({ id: recId, file: audio.dataset.file }); if (!u) return B.toast('Fichier audio absent (dossier non connecté ?)'); audio.src = u; }
    audio.currentTime = Math.max(0, t / 1000 - 2);
    audio.play();
    audio.closest('.recrow').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  /* ---------- bouton d'état dans la barre d'outils ---------- */
  R.ui = function () {
    B.$$('[data-act="rec"]').forEach((b) => {
      b.classList.toggle('on', R.state === 'rec');
      b.classList.toggle('paused', R.state === 'paused');
      b.textContent = R.state === 'idle' ? '● Enregistrer' : (R.state === 'paused' ? '❚❚ ' : '● ') + B.fmtTime(R.elapsed());
      b.title = R.state === 'idle' ? 'Enregistrer le cours (micro)' : 'Enregistrement en cours : cliquer pour les options';
    });
    B.$$('[data-act="stamp"],[data-act="recpause"]').forEach((b) => { b.hidden = R.state === 'idle'; });
    B.$$('[data-act="recpause"]').forEach((b) => { b.textContent = R.state === 'paused' ? '▶ Reprendre' : '❚❚ Pause'; });
    document.body.classList.toggle('recording', R.state !== 'idle');
  };
})();
