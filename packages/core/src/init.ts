/** Initialisation d'un nouveau wiki : configuration, racine, catégories par défaut (§8.1). */
import { CONFIG_PATH, DEFAULT_MASTERY, serializeConfig, type WikiConfig } from "./config.ts";
import { serializePage } from "./pages.ts";
import { joinPath, normalizePath } from "./paths.ts";
import { folderNameFor } from "./slug.ts";
import { isoTimestamp } from "./time.ts";
import type { Visibility } from "./types.ts";
import { ulid } from "./ulid.ts";

/** Catégories de premier niveau proposées par défaut (doc fonctionnelle §1). */
export const DEFAULT_CATEGORIES: readonly string[] = [
  "Arts et culture",
  "Économie et finance",
  "Géographie",
  "Histoire",
  "Langues et linguistique",
  "Médecine et santé",
  "Militaire et défense",
  "Nature et environnement",
  "Philosophie et pensée",
  "Religion et croyances",
  "Science",
  "Société et sciences sociales",
  "Sports et loisirs",
  "Technologie",
  "Transports",
];

export const PUBLISH_WORKFLOW_PATH = ".github/workflows/eugenia-publish.yml";
export const DEPLOY_KEY_SECRET = "EUGENIA_DEPLOY_KEY";
export const DEFAULT_ACTION_REF = "openEugenia/eugenia@v1";

export interface ScaffoldOptions {
  title: string;
  root?: string;
  categories?: readonly string[];
  defaultVisibility?: Visibility;
  privateRepo?: string;
  /** Dépôt public cible : ajoute le workflow de publication. */
  publicRepo?: string;
  actionRef?: string;
  branch?: string;
  now?: Date;
}

/** Workflow GitHub Actions du dépôt privé : publication à chaque push (§6.4). */
export function publishWorkflow(
  publicRepo: string,
  options: { actionRef?: string; branch?: string } = {},
): string {
  const branch = options.branch ?? "main";
  return `# Publie la partie publique du wiki dans ${publicRepo} à chaque push.
# Généré par Eugenia. Secret requis : ${DEPLOY_KEY_SECRET} (clé de déploiement en écriture
# sur ${publicRepo}), créé par \`eugenia init --github\`.
name: Eugenia — publication

on:
  push:
    branches: [${branch}]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: eugenia-publish
  cancel-in-progress: true

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ${options.actionRef ?? DEFAULT_ACTION_REF}
        with:
          target: ${publicRepo}
          deploy-key: \${{ secrets.${DEPLOY_KEY_SECRET} }}
`;
}

function readme(title: string, root: string): string {
  return [
    `# ${title}`,
    "",
    "Wiki personnel de connaissances géré avec [Eugenia](https://github.com/openEugenia/eugenia).",
    "",
    `- Les pages sont dans \`${root || "."}/\` : chaque page est un dossier contenant un \`index.md\`.`,
    "- Les fichiers et dossiers préfixés par `_` ou `.` sont réservés à l'application.",
    "- Ce dépôt doit rester **privé** : il contient aussi vos connaissances privées.",
    "",
    "Ouvrez-le dans l'application : <https://openeugenia.github.io/eugenia/>.",
    "",
  ].join("\n");
}

const WELCOME = `Bienvenue dans votre wiki personnel.

Chaque page est une **note** ou une **connaissance atomique** (flashcard). Les catégories
ci-dessous sont des points de départ : renommez-les, supprimez-les ou ajoutez les vôtres.
Eugenia vous aide à extraire des connaissances de vos textes, à décrire chaque sous-wiki et
à réviser par des quiz.`;

/** Fichiers d'un nouveau wiki, prêts à être commités. */
export function scaffoldWiki(options: ScaffoldOptions): Map<string, string> {
  const now = options.now ?? new Date();
  const root = normalizePath(options.root ?? "wiki");
  const visibility: Visibility = options.defaultVisibility ?? "private";
  const config: WikiConfig = {
    title: options.title,
    root,
    default_visibility: visibility,
    folder_name_max_length: 32,
    mastery: { ...DEFAULT_MASTERY },
    extra: {},
  };
  if (options.privateRepo) config.private_repo = options.privateRepo;

  const files = new Map<string, string>();
  files.set(CONFIG_PATH, serializeConfig(config));
  const stamp = isoTimestamp(now);
  let tick = now.getTime();
  files.set(
    joinPath(root, "index.md"),
    serializePage({
      fields: {
        id: ulid(tick++),
        type: "note",
        title: options.title,
        visibility,
        created: stamp,
        updated: stamp,
      },
      extra: {},
      body: WELCOME,
    }),
  );
  const taken = new Set<string>();
  for (const category of options.categories ?? DEFAULT_CATEGORIES) {
    const name = folderNameFor(category, taken, config.folder_name_max_length);
    taken.add(name);
    files.set(
      joinPath(root, name, "index.md"),
      serializePage({
        fields: {
          id: ulid(tick++),
          type: "note",
          title: category,
          visibility,
          created: stamp,
          updated: stamp,
        },
        extra: {},
        body: "",
      }),
    );
  }
  if (root !== "") files.set("README.md", readme(options.title, root));
  if (options.publicRepo) {
    const workflowOptions: { actionRef?: string; branch?: string } = {};
    if (options.actionRef) workflowOptions.actionRef = options.actionRef;
    if (options.branch) workflowOptions.branch = options.branch;
    files.set(PUBLISH_WORKFLOW_PATH, publishWorkflow(options.publicRepo, workflowOptions));
  }
  return files;
}
