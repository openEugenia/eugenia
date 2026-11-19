# Wiki de démonstration

Exemple de dépôt **privé** d'un wiki [Eugenia](https://github.com/openEugenia/eugenia), utilisé par
la documentation et les tests. Il reprend les exemples de la documentation fonctionnelle (Lilith,
la Lune noire) et montre les trois espaces d'un wiki :

- **le wiki** (`wiki/`) : des catégories, des connaissances atomiques (`type: knowledge`) qui
  citent leurs sources, et les flashcards (`type: flashcard`) qui les testent, dont une
  connaissance à deux flashcards et une connaissance « à sourcer » ;
- **la bibliothèque** (`library/`) : des sources (`type: source`), publiques ou privées, dont un
  article avec son fichier personnel (jamais publié) ;
- **les discussions** (`discussions/`) : une discussion libre, une question sur l'arbre, une
  note rapide d'où une connaissance a été extraite, et un quiz, trace des révisions d'où est
  recalculée la maîtrise ;
- des pages publiques et privées (`visibility`), et les descriptions des sous-wikis, en portée
  privée (`_summary.md`) et publique (`_summary.public.md`).

Validez-le et construisez sa partie publique :

```sh
pnpm eugenia validate examples/demo-wiki
pnpm eugenia publish examples/demo-wiki --out /tmp/demo-public
```
