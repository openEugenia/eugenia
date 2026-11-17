# Charte graphique openEugenia (copie)

`openeugenia.css` est une copie de la feuille de style compilée de la charte graphique commune
de l'écosystème openEugenia : <https://github.com/hwattez/Graphic-charter> (documentation :
<https://openeugenia.github.io/Graphic-charter/>), licence MIT.

- Version : 0.3.0 (commit `9caa394`), fichier `dist/openeugenia.css`.
- Elle fournit les jetons `--oe-*` (couleurs claires et sombres, typographie, espacements),
  les styles de base et les composants `oe-*` (boutons, cartes, badges, alertes, champs…).

La charte n'est pas encore publiée sur npm : quand elle le sera, remplacer cette copie par la
dépendance `@openeugenia/graphic-charter` (`import "@openeugenia/graphic-charter/css"`).
Pour mettre à jour la copie : `npm run build` dans le dépôt de la charte, puis recopier
`dist/openeugenia.css` ici.
