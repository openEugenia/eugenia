# Prompts d'Eugenia

Ces fichiers définissent le rôle d'Eugenia pour chaque tâche. Ils sont **versionnés** ici pour
que chacun puisse vérifier ce qui est demandé à l'IA, et **surchargeables** dans un wiki :
un fichier `.notes/prompts/<nom>.md` du dépôt de l'utilisateur remplace le prompt du même nom.

| Fichier | Tâche |
|---|---|
| `extract.md` | Surlignage de connaissances atomiques dans un texte, puis proposition de flashcards (§8.1). |
| `summarize.md` | Description d'un sous-wiki, ou résumé d'une discussion (§11.2). |
| `evaluate.md` | Comparaison d'une réponse de quiz à la réponse attendue : retour et score dans [0, 1] (§8.3). |
| `discuss.md` | Rôle d'Eugenia dans une discussion ouverte depuis une page (§8.4). |
| `ask.md` | Questions sur l'arbre : exploration des descriptions, puis réponse avec citations (§8.5). |
| `categories.md` | Suggestion de sous-catégories (§8.1). |

Un frontmatter YAML facultatif est ignoré. Variables disponibles : `{{wiki_title}}`, `{{today}}`.

Le format de la réponse (schéma JSON) et les données envoyées (balises `<...>` du message) sont
définis dans `src/tasks/`. Après modification d'un prompt, régénérez le module embarqué :

```sh
pnpm --filter @openeugenia/ai prompts
```
