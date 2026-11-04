# Bǐjì 笔记 · notes de chinois

Prise de notes pour les cours de chinois : clavier et stylet sur la même page, enregistrement du cours, vocabulaire.
Site statique, sans serveur ni compte. En ligne : **https://valentinauclerc.github.io/biji/** (Edge ou Chrome conseillés).
Une fois visité, il marche hors ligne.

## Ce que ça fait

- **Éditeur riche** : gras, couleurs, surligneur, titres, listes, encadrés, **tableaux** (lignes/colonnes, en-tête, fusion).
  Les lignes vides restent.
- **Saisie pinyin → 汉字** (bouton « 中 » ou Maj seule) : taper `nihao` puis Espace → 你好, sens en français sous chaque
  proposition, phrases entières (`woshixuesheng` → 我是学生). Espace = 1er choix, 1-9 = choix, Entrée = garder les lettres.
- **Pinyin automatique** au-dessus des caractères (couleur par ton), lu en contexte (银行 → yín háng).
  Affiché / au survol / masqué (Alt+P).
- **Tons au clavier français** : `ni3 hao3` → `nǐ hǎo` (5 = neutre, `v` = `ü`).
  Sélectionner du pinyin propose les caractères ; sélectionner des caractères permet de les remplacer par leur pinyin.
- **Pavé 手写** (Alt+H) : écrire un mot de 1 à 3 caractères au stylet. Reconnaissance Google en ligne (lit des mots
  entiers, désactivable) avec repli hors ligne (HanziLookupJS, un caractère par case).
- **Dessin libre** au stylet (pression, surligneur, gomme). Le **bout gomme du stylet** efface. Le doigt fait défiler,
  la paume est ignorée. Une zone de test du stylet est dans Réglages.
- **Enregistrement du cours** (● Enregistrer) : audio Opus sauvé toutes les 5 s (rien n'est perdu si l'onglet plante),
  repères ⏱ dans les notes (Alt+M) pour réécouter un passage, vitesse de lecture réglable.
- **Clic sur un mot** : sens en français (anglais en secours), voix, ordre des traits animé, quiz d'écriture, ajout au
  vocabulaire, correction de la lecture d'un caractère polyphone.
- **Cases 田** : modèle + cases à repasser (modèle en transparence sur les premières).
- **Vocabulaire par cours** et révision Lire 读 / Écrire 写 (boîtes de Leitner).

## Stockage

- Toujours dans le navigateur (IndexedDB).
- **Dossier sur le disque** (recommandé, Chrome/Edge) : un fichier `.json` par cours, l'audio dans `audio/`. Un dossier
  OneDrive donne sauvegarde et synchro entre PC. Le navigateur redemande l'autorisation à chaque ouverture
  (bouton « Reconnecter »).
- **Google Drive** (téléphone, tablette, autres PC) : « Se connecter avec Google », tout est rangé dans un dossier
  `Biji/` du Drive (même format, audio dans `Biji/audio/`). Permission `drive.file` : Biji ne voit que ses propres
  fichiers. Synchro à l'ouverture, toutes les 45 s et au retour sur l'onglet ; la connexion Google dure 1 h, ensuite
  un clic sur « ☁ Reconnecter » (rien n'est perdu entre-temps). Le plus récent gagne ; si le cours ouvert change
  ailleurs pendant qu'on écrit, un bandeau propose « Afficher cette version » ou « Garder la mienne ».
  Dossier et Drive peuvent être actifs ensemble (ce qui arrive du Drive est recopié dans le dossier).
- Export/import d'une sauvegarde (sans l'audio) dans Réglages. Les cours de la V1 sont convertis automatiquement.

## Activer la synchro Google Drive (une seule fois)

Sans identifiant Google, le site fonctionne normalement et n'affiche pas la synchro.

1. https://console.cloud.google.com/projectcreate : créer un projet « Biji ».
2. API et services › Bibliothèque › **Google Drive API** › Activer.
3. Écran de consentement OAuth (Google Auth Platform) : type **Externe**, nom « Biji », e-mail de contact ;
   champ d'application `.../auth/drive.file` ; **Audience › Utilisateurs test** : ajouter son adresse Gmail.
   Rester en mode « Test » (pas de validation Google ; l'écran « Google n'a pas validé cette application » est normal).
4. Identifiants › Créer › **ID client OAuth** › Application Web ; *Origines JavaScript autorisées* :
   `https://valentinauclerc.github.io` (et `http://localhost:8080` pour le dev). Pas d'URI de redirection.
5. Copier l'ID client (`….apps.googleusercontent.com`, public, pas un secret) dans `site/config.js`, puis pousser.

## Développement

```bash
npm ci
npm run data      # télécharge les sources (data/, non versionné) et régénère site/data/* — rarement utile
npm run build     # src/*.js -> site/app.js (esbuild) + site/sw.js
npm run watch     # idem en continu
npm test          # bout en bout : playwright-core + chromium, stylet et micro simulés
node tests/ime-engine.mjs   # moteur pinyin -> 汉字
node tests/cloud.js         # synchro Google Drive PC <-> téléphone contre un faux Drive local
```

`site/data/` (dictionnaire, traits, reconnaissance) est versionné ; le JS est construit par la CI
(`.github/workflows/pages.yml`) à chaque push sur `main`. Après `npm run build`, `site/index.html` s'ouvre aussi en `file://`.

## Crédits et licences

- Dictionnaire : CFDICT (Chine Informations, CC BY-SA 3.0), compléments french-cedict (Laowai, CC BY-SA 4.0),
  CC-CEDICT (MDBG, CC BY-SA 4.0). Fréquences : wordfreq (CC BY-SA 4.0).
- Éditeur : TipTap / ProseMirror (MIT). Pinyin : pinyin-pro (MIT). Ordre des traits : Hanzi Writer (MIT),
  données Make Me a Hanzi (Arphic Public License).
- Reconnaissance manuscrite hors ligne : HanziLookupJS (GPL v3), d'après HanziLookup de Jordan Kiang.
- Police : Instrument Serif (OFL).
