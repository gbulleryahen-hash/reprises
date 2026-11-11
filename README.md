# Éditeur de reprises de dressage

Petit site statique pour dessiner les figures d'une reprise de dressage, case par case, sur une carrière 20 × 40 ou 20 × 60 (verticale ou horizontale).

## Fonctions

- Une reprise = une suite de cases : carrière + remarques en dessous, bouton **+** pour ajouter une case.
- Outils : main levée (lissée), ligne droite, cercle et arc de 6, 10, 12, 15 ou 20 m.
- Les extrémités des tracés s'accrochent précisément aux lettres (désactivable).
- Couleurs par allure : pas (bleu), pas allongé (bleu foncé), trot de travail (vert), trot allongé (vert foncé), galop de travail (rouge), galop allongé (rouge foncé), piaffer (violet), passage (violet foncé).
- Symboles : arrêt, cession à la jambe, épaule en dedans, appuyer.
- Gomme, annuler (Ctrl+Z), réordonner et supprimer les cases.
- Enregistrement automatique dans le navigateur, et **Enregistrer / Ouvrir** un fichier `.reprise.json` sur l'ordinateur.
- Impression A4 (2 cases par ligne, légende des couleurs en haut).

## Mise en ligne sur GitHub Pages

1. Déposer `index.html`, `style.css` et `app.js` à la racine du dépôt.
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Le site sera disponible à l'adresse `https://<utilisateur>.github.io/reprises/`.

Aucune dépendance, aucune compilation : on peut aussi ouvrir `index.html` directement dans le navigateur.

## Licence

Copyright (C) 2026 gbulleryahen-hash

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la
**Licence publique générale GNU (GPL) version 3**, ou (à votre choix) toute version ultérieure,
telle que publiée par la Free Software Foundation.

Ce programme est distribué dans l'espoir qu'il sera utile, mais SANS AUCUNE GARANTIE, sans même la garantie
implicite de QUALITÉ MARCHANDE ou d'ADÉQUATION À UN USAGE PARTICULIER. Voir le fichier [LICENSE](LICENSE)
pour le texte complet de la licence.
