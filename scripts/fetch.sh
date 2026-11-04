#!/usr/bin/env bash
# Télécharge les sources de données (une fois). Relancer pour mettre à jour.
set -euo pipefail
cd "$(dirname "$0")/../data"
curl -fsSL -o french-cedict.json.gz https://raw.githubusercontent.com/MityaPolianskii/french-cedict/main/data/dictionary.json.gz
curl -fsSL -o cedict.txt.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
rm -rf hanzilookup && git clone -q --depth 1 https://github.com/gugray/HanziLookupJS hanzilookup
[ -f package.json ] || npm init -y >/dev/null
npm i --silent pinyin-pro@3 hanzi-writer@3 hanzi-writer-data@2 @fontsource/instrument-serif@5
echo "OK"
