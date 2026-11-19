/** Validation du format d'un wiki (CLI `validate`, publication, édition hors application). */
import { parseDiscussion, quizEvents } from "./discussion.ts";
import { internalLinks, linkedNode } from "./links.ts";
import type { WikiView } from "./operations.ts";
import { knowledgeStatement, parseFlashcardBody, parsePage } from "./pages.ts";
import { joinPath, normalizePath } from "./paths.ts";
import { publicSummaryProblems } from "./publish.ts";
import { parseSummary } from "./summaries.ts";
import type { Problem } from "./types.ts";

export interface ValidationOptions {
  /** Vérifier les liens internes (par défaut : oui). */
  links?: boolean;
}

export async function validateWiki(
  view: WikiView,
  configProblems: readonly string[] = [],
  options: ValidationOptions = {},
): Promise<Problem[]> {
  const { tree, files } = view;
  const problems: Problem[] = configProblems.map((message) => ({
    level: "error",
    code: "invalid-config",
    message,
    path: ".notes/config.yml",
  }));
  problems.push(...tree.problems);

  for (const node of tree.nodes.values()) {
    if (node.virtual) continue;
    const text = await view.readText(node.indexPath);
    const doc = parsePage(text);
    const warn = (code: string, message: string): void => {
      problems.push({ level: "warning", code, message, path: node.indexPath, nodeId: node.id });
    };
    if (node.type === "flashcard") {
      const card = parseFlashcardBody(doc.body);
      const missing = [
        card.question ? null : "question",
        card.answer ? null : "réponse attendue",
      ].filter(Boolean);
      if (missing.length > 0) {
        warn(
          "flashcard-incomplete",
          `Flashcard « ${node.title} » : section(s) manquante(s) : ${missing.join(", ")}.`,
        );
      }
    }
    if (node.type === "knowledge" && !knowledgeStatement(doc.body)) {
      warn("knowledge-empty", `La connaissance « ${node.title} » n'a pas d'énoncé.`);
    }
    if (node.type === "source" && doc.fields.file) {
      if (!files.has(normalizePath(joinPath(node.path, doc.fields.file)))) {
        warn(
          "missing-source-file",
          `La source « ${node.title} » cite le fichier personnel « ${doc.fields.file} », introuvable.`,
        );
      }
    }
    for (const source of doc.fields.sources ?? []) {
      if (!source.ref) continue;
      const target = tree.nodes.get(source.ref);
      if (!target) {
        warn("unknown-source", `« ${node.title} » cite une source inconnue (${source.ref}).`);
      } else if (target.type !== "source") {
        warn(
          "not-a-source",
          `« ${node.title} » cite « ${target.title} », qui n'est pas une source de la bibliothèque.`,
        );
      }
    }
    if (options.links !== false) {
      for (const target of internalLinks(doc.body, node.indexPath)) {
        if (files.has(target.path) || linkedNode(tree, target)) continue;
        problems.push({
          level: "warning",
          code: "broken-link",
          message: `« ${node.title} » contient un lien cassé vers « ${target.path} ».`,
          path: node.indexPath,
          nodeId: node.id,
        });
      }
    }

    for (const [scope, file] of [
      ["private", node.summaries.private],
      ["public", node.summaries.public],
    ] as const) {
      if (!file) continue;
      const summary = parseSummary(await view.readText(file.path));
      if (summary.error) {
        problems.push({
          level: "error",
          code: "invalid-summary",
          message: summary.error,
          path: file.path,
        });
        continue;
      }
      if (summary.fields.scope !== scope) {
        problems.push({
          level: "error",
          code: "summary-scope",
          message: `« ${file.path} » devrait avoir la portée « ${scope} ».`,
          path: file.path,
          nodeId: node.id,
        });
      } else if (scope === "public" && node.isPublic) {
        problems.push(...publicSummaryProblems(tree, node, summary));
      }
    }
  }

  for (const file of tree.discussions) {
    const discussion = parseDiscussion(await view.readText(file.path));
    if (discussion.error) {
      problems.push({
        level: "warning",
        code: "invalid-discussion",
        message: discussion.error,
        path: file.path,
      });
      continue;
    }
    if (!discussion.fields.id) {
      problems.push({
        level: "warning",
        code: "missing-id",
        message: `La discussion « ${file.path} » n'a pas d'identifiant (id).`,
        path: file.path,
      });
    }
    for (const id of [discussion.fields.about, discussion.fields.scope_node]) {
      if (id && !tree.nodes.has(id)) {
        problems.push({
          level: "warning",
          code: "discussion-unknown-node",
          message: `La discussion « ${file.path} » est rattachée à une page inconnue (${id}).`,
          path: file.path,
        });
      }
    }
    if (discussion.fields.kind === "quiz" && discussion.fields.visibility === "public") {
      const privateCard = quizEvents(discussion).find(
        (e) => tree.nodes.get(e.card)?.isPublic === false,
      );
      if (privateCard) {
        problems.push({
          level: "warning",
          code: "public-quiz-private-card",
          message: `Le quiz « ${file.path} » est marqué public mais porte sur des flashcards privées : il ne sera jamais publié.`,
          path: file.path,
        });
      }
    }
  }
  return problems;
}

export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((p) => p.level === "error");
}
