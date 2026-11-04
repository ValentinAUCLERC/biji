// Test du moteur pinyin -> hanzi (node tests/ime-engine.mjs) : dictionnaire réel, sans navigateur
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
const g = globalThis;
g.window = g; g.addEventListener = () => {}; g.document = { addEventListener() {}, dispatchEvent() {}, createElement() { return {}; }, head: { appendChild() {} } };
g.localStorage = { getItem: () => null, setItem() {} };
g.CustomEvent = class {}; g.Element = function () {};
eval(readFileSync('site/data/syllables.js', 'utf8'));
const code = (await esbuild.build({ stdin: { contents: "import './src/util.js'; import './src/lex.js'; import './src/ime.js';", resolveDir: '.' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
eval(code);
const B = g.Biji;
B.loadScript = async (src) => { eval(readFileSync('site/' + src, 'utf8')); };
await B.lex.load();
const cases = [['nihao', '你好'], ['xiexie', '谢谢'], ['woshixuesheng', '我是学生'], ['laoshi', '老师'], ['zhongguo', '中国'], ['shi', '是'], ['wo', '我'], ['nihaoma', '你好吗'], ['women', '我们'], ['xian', '先'], ["xi'an", '西安'], ['lvse', '绿色'], ['zaijian', '再见'], ['duibuqi', '对不起'], ['woaini', '我爱你'], ['jintiantianqihenhao', '今天天气很好'], ['nih', '你好'], ['zhongw', '中文'], ['beijing', '北京'], ['hen', '很']];
let ok = 0;
for (const [inp, want] of cases) {
  const c = B.ime.candidates(inp);
  const top = c.slice(0, 6).map((x) => x.w + (x.consume < inp.length ? '…' : ''));
  const hit = c[0] && c[0].w === want;
  if (hit) ok++;
  console.log((hit ? 'OK   ' : (top.some((t) => t === want) ? 'TOP6 ' : 'FAIL ')) + inp.padEnd(22) + top.join(' '));
}
console.log(`${ok}/${cases.length} en premier`);
console.log('convert « nǐ hǎo » :', B.ime.convertText('nǐ hǎo').map((x) => x.w).join(' '));
console.log('convert « ni3 hao3 » :', B.ime.convertText('ni3 hao3').map((x) => x.w).join(' '));
console.log('convert « xuésheng » :', B.ime.convertText('xuésheng').map((x) => x.w).join(' '));
