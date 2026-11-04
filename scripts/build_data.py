#!/usr/bin/env python3
"""Génère les données statiques du site (rejouable, idempotent).

Entrées :
  data/french-cedict.json.gz   compilation chinois-français (CFDICT + ajouts relus), CC BY-SA   (scripts/fetch.sh)
  data/cedict.txt.gz           CC-CEDICT (anglais), CC BY-SA 4.0                                (scripts/fetch.sh)
  data/hanzilookup/dist        HanziLookupJS (GPL) : reconnaissance manuscrite hors ligne      (scripts/fetch.sh)
  node_modules/                hanzi-writer-data, @fontsource/instrument-serif                 (npm ci)
  wordfreq (pip)               fréquences d'usage du chinois, pour classer les candidats pinyin

Sorties : site/data/{dict,syllables,hlookup}.js, site/data/hw/<code>.js, site/vendor/, site/fonts/
"""
import gzip, json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = ROOT / "site"
NM = ROOT / "node_modules"


def clean(s):
    return re.sub(r"\s+", " ", s.replace("|", "/")).strip()


def build_dict():
    from wordfreq import get_frequency_dict, zipf_frequency  # noqa: F401
    import math
    freq = get_frequency_dict("zh")

    def zipf(w):
        f = freq.get(w)
        return 0 if not f else max(1, round((math.log10(f) + 9) * 10))  # échelle Zipf ×10 (≈ 10..90)

    fr = json.load(gzip.open(DATA / "french-cedict.json.gz", "rt", encoding="utf-8"))
    rows, seen = [], set()
    for e in fr:
        senses_fr = [clean(x) for x in (e.get("translation") or "").split("\n") if x.strip()]
        senses_en = [clean(x) for x in e.get("source_english_segments") or [] if x.strip()]
        key = (e["traditional"], e["simplified"], e["pinyin"])
        seen.add(key)
        rows.append([e["simplified"], e["traditional"], e["pinyin"], "|".join(senses_fr), "|".join(senses_en)])
    extra = 0
    line_re = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")
    for line in gzip.open(DATA / "cedict.txt.gz", "rt", encoding="utf-8"):
        if line.startswith("#"):
            continue
        m = line_re.match(line)
        if not m:
            continue
        trad, simp, py, defs = m.groups()
        if (trad, simp, py) in seen:
            continue
        extra += 1
        rows.append([simp, trad, py, "", "|".join(clean(d) for d in defs.split("/") if d.strip())])
    for r in rows:
        r.append(str(zipf(r[0])))
        for f in r:
            assert "\t" not in f and "\n" not in f, r
    # syllabes pinyin valides (conversion « ni3 » -> « nǐ » et découpage pour la saisie pinyin -> hanzi)
    cnt = {}
    for r in rows:
        for s in r[2].split():
            m = re.fullmatch(r"([a-zv]+)[1-5]", s.lower().replace("u:", "v"))
            if m:
                cnt[m.group(1)] = cnt.get(m.group(1), 0) + 1
    syl = {k for k, v in cnt.items() if v >= 3 and len(k) <= 6} | {"nin", "den", "eng", "lo", "yo", "nun"}
    syl -= {"r", "xx", "m", "n", "ng", "hm", "hng"}
    (SITE / "data" / "syllables.js").write_text(
        "window.BIJI_SYL=" + json.dumps(" ".join(sorted(syl))) + ";\n", encoding="utf-8")
    text = "\n".join("\t".join(r) for r in rows)
    out = SITE / "data" / "dict.js"
    out.write_text("window.BIJI_DICT_RAW=" + json.dumps(text, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"dict.js : {len(rows)} entrées ({len(rows)-extra} FR, {extra} EN seul), {out.stat().st_size/1e6:.1f} Mo, {len(syl)} syllabes")


def build_hlookup():
    src = DATA / "hanzilookup" / "dist"
    parts = []
    for name in ("mmah", "orig"):
        parts.append(f"window.BIJI_HL_{name.upper()}=" + (src / f"{name}.json").read_text(encoding="utf-8").strip() + ";")
    (SITE / "data" / "hlookup.js").write_text("\n".join(parts) + "\n", encoding="utf-8")
    shutil.copy(src / "hanzilookup.min.js", SITE / "vendor" / "hanzilookup.min.js")
    print("hlookup.js OK")


def build_hw():
    out = SITE / "data" / "hw"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    n = 0
    for f in (NM / "hanzi-writer-data").glob("*.json"):
        ch = f.stem
        if len(ch) != 1:
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        (out / f"{ord(ch):x}.js").write_text(
            "window.BIJI_HW&&BIJI_HW(" + json.dumps(ch) + "," + json.dumps(d, separators=(",", ":")) + ");",
            encoding="utf-8")
        n += 1
    print(f"hw : {n} caractères")


def vendor():
    fonts = SITE / "fonts"
    fonts.mkdir(exist_ok=True)
    for f in ("instrument-serif-latin-400-normal.woff2", "instrument-serif-latin-400-italic.woff2",
              "instrument-serif-latin-ext-400-normal.woff2"):
        shutil.copy(NM / "@fontsource/instrument-serif/files" / f, fonts / f)
    print("fonts OK")


if __name__ == "__main__":
    (SITE / "data").mkdir(parents=True, exist_ok=True)
    (SITE / "vendor").mkdir(parents=True, exist_ok=True)
    steps = sys.argv[1:] or ["vendor", "dict", "hlookup", "hw"]
    for s in steps:
        {"vendor": vendor, "dict": build_dict, "hlookup": build_hlookup, "hw": build_hw}[s]()
