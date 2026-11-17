# Wiki de démonstration

Exemple de dépôt **privé** d'un wiki [Eugenia](https://github.com/openEugenia/eugenia), utilisé par
la documentation et les tests. Il reprend les exemples de la documentation fonctionnelle (Lilith,
la Lune noire) et montre :

- des pages publiques et privées (`visibility`) ;
- des connaissances atomiques (`type: flashcard`) extraites d'une note source ;
- les descriptions des sous-wikis, en portée privée (`_summary.md`) et publique (`_summary.public.md`) ;
- un quiz (`_quizzes/`), trace des révisions d'où est recalculée la maîtrise ;
- une discussion avec Eugenia (`_discussions/`).

Validez-le et construisez sa partie publique :

```sh
pnpm eugenia validate examples/demo-wiki
pnpm eugenia publish examples/demo-wiki --out /tmp/demo-public
```
