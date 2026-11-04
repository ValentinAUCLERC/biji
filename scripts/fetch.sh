#!/usr/bin/env bash
# Télécharge les sources de données dans data/ (non versionné). Versions figées pour un build reproductible.
set -euo pipefail
cd "$(dirname "$0")/../data"
FR_CEDICT=ebf1d269182d84e4068d1ce383eaf272c7adff66
HANZILOOKUP=b21124f771ddd91f131e62aa478bc188f6ec78d3
curl -fsSL -o french-cedict.json.gz "https://raw.githubusercontent.com/MityaPolianskii/french-cedict/$FR_CEDICT/data/dictionary.json.gz"
curl -fsSL -o cedict.txt.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
rm -rf hanzilookup && mkdir hanzilookup && cd hanzilookup
git init -q && git fetch -q --depth 1 https://github.com/gugray/HanziLookupJS "$HANZILOOKUP" && git checkout -q FETCH_HEAD
echo "données OK"
