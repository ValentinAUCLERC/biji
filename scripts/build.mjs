// Bundle de l'application : src/main.js -> site/app.js (IIFE, fonctionne aussi en file://)
// + génère site/sw.js avec un identifiant de build (cache hors ligne)
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'edge110', 'firefox115', 'safari16'],
  outfile: 'site/app.js',
  minify: !watch,
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'info',
};

// pdf.js (import de PDF) : copié tel quel, chargé seulement au premier PDF importé
function copyPdfjs() {
  const src = 'node_modules/pdfjs-dist', dst = 'site/vendor/pdfjs';
  mkdirSync(dst, { recursive: true });
  for (const f of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs']) cpSync(src + '/' + f, dst + '/' + f.split('/').pop());
  for (const d of ['cmaps', 'standard_fonts', 'wasm']) cpSync(src + '/' + d, dst + '/' + d, { recursive: true });
  cpSync(src + '/LICENSE', dst + '/LICENSE');
}

function writeSw() {
  const build = Date.now().toString(36);
  // le cache des données (≈ 60 Mo) ne change qu'avec les données elles-mêmes, pas à chaque build
  const h = createHash('sha1');
  for (const f of ['site/data/dict.js', 'site/data/hlookup.js', 'site/vendor/hanzilookup.min.js', 'site/vendor/pdfjs/pdf.min.mjs']) if (existsSync(f)) h.update(readFileSync(f));
  const data = h.digest('hex').slice(0, 10);
  const tpl = readFileSync('src/sw.template.js', 'utf8').replace('__BUILD__', build).replace('__DATA__', data);
  writeFileSync('site/sw.js', tpl);
  writeFileSync('site/build.js', `window.BIJI_BUILD=${JSON.stringify(build)};\n`);
}

if (watch) {
  const ctx = await esbuild.context(opts);
  copyPdfjs();
  writeSw();
  await ctx.watch();
} else {
  await esbuild.build(opts);
  copyPdfjs();
  writeSw();
}
