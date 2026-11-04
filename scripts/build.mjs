// Bundle de l'application : src/main.js -> site/app.js (IIFE, fonctionne aussi en file://)
// + génère site/sw.js avec un identifiant de build (cache hors ligne)
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

function writeSw() {
  const build = Date.now().toString(36);
  // le cache des données (≈ 60 Mo) ne change qu'avec les données elles-mêmes, pas à chaque build
  const h = createHash('sha1');
  for (const f of ['site/data/dict.js', 'site/data/hlookup.js', 'site/vendor/hanzilookup.min.js']) if (existsSync(f)) h.update(readFileSync(f));
  const data = h.digest('hex').slice(0, 10);
  const tpl = readFileSync('src/sw.template.js', 'utf8').replace('__BUILD__', build).replace('__DATA__', data);
  writeFileSync('site/sw.js', tpl);
  writeFileSync('site/build.js', `window.BIJI_BUILD=${JSON.stringify(build)};\n`);
}

if (watch) {
  const ctx = await esbuild.context(opts);
  writeSw();
  await ctx.watch();
} else {
  await esbuild.build(opts);
  writeSw();
}
