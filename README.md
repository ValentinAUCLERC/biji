# Bǐjì 笔记 · notes de chinois

Site de prise de notes pour les cours de chinois : clavier + stylet sur la même page.
Statique, sans serveur, sans compte : on ouvre `site/index.html` dans Edge ou Chrome.

## Ce que ça fait

- **Blocs texte** : taper les hanzi avec le clavier chinois de Windows. Le pinyin (couleur par ton) s'affiche au-dessus.
  `ni3 hao3` devient `nǐ hǎo` (5 = ton neutre, `v` = `ü`). `# titre`, `- liste`.
- **Pavé 手写** (Alt+H) : écrire un caractère au stylet, cliquer le bon candidat, il s'insère au curseur.
  La reconnaissance tourne hors ligne (HanziLookupJS).
- **Clic sur un mot** : sens en français (anglais en secours), prononciation, ordre des traits animé, quiz d'écriture,
  ajout au vocabulaire, **correction du pinyin** quand la lecture automatique se trompe (stockée en `行[xíng]` dans le texte).
- **Dessin libre** : stylet avec pression, surligneur, gomme (ou bouton arrière du stylet), le doigt fait défiler, la paume est ignorée.
- **Cases 田** : modèle + cases à repasser (modèle en transparence sur les premières).
- **Vocabulaire par cours** : mots repérés automatiquement dans les notes, révision Lire 读 / Écrire 写 (boîtes de Leitner).
- **Pinyin affiché / au survol / masqué** (Alt+P) pour s'auto-tester.

## Stockage

- Toujours dans le navigateur (IndexedDB).
- **Dossier sur le disque** (recommandé, Chrome/Edge) : un fichier `.json` par cours. Un dossier OneDrive permet
  sauvegarde et synchro entre PC. Le navigateur redemande l'autorisation à chaque ouverture (bouton « Reconnecter »).
- Export/import d'une sauvegarde complète dans Réglages.

## Voix

Web Speech du système. Edge fournit d'office des voix chinoises naturelles (Xiaoxiao Online). Sous Chrome :
Paramètres Windows › Heure et langue › Voix › Ajouter des voix › Chinois (simplifié).

## Développement

```bash
bash scripts/fetch.sh          # télécharge dictionnaires + libs dans data/ (non versionné)
python3 scripts/build_data.py  # génère site/data/* et site/vendor/*
node tests/e2e.js              # test de bout en bout (playwright-core + chromium), stylet simulé
node tests/sync.js             # test de la synchro dossier (servir site/ en http sur :8765)
```

Tout est en scripts classiques (pas de modules ES, pas de fetch) pour fonctionner en `file://`.

## Crédits et licences

- Dictionnaire : CFDICT (Chine Informations, CC BY-SA 3.0), compléments french-cedict (Laowai, CC BY-SA 4.0),
  CC-CEDICT (MDBG, CC BY-SA 4.0).
- Pinyin : pinyin-pro (MIT). Ordre des traits : Hanzi Writer (MIT), données Make Me a Hanzi (Arphic Public License).
- Reconnaissance manuscrite : HanziLookupJS (GPL v3), d'après HanziLookup de Jordan Kiang.
- Police : Instrument Serif (OFL).
