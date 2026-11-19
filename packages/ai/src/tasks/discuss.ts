/**
 * Discussions avec Eugenia (§8.4) : discussion libre à partir d'une page, ou note rapide
 * (Eugenia répond aussitôt par des connaissances candidates et des pistes de sources).
 */
import type { DiscussionKind } from "@openeugenia/core";
import type { ChatMessage, GenerateRequest } from "../types.ts";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export interface DiscussionPage {
  id: string;
  title: string;
  type: string;
  /** Titres des ancêtres. */
  path: readonly string[];
  content: string;
}

export interface RelatedPage {
  id: string;
  title: string;
  description?: string;
}

export interface DiscussionTurn {
  role: "user" | "eugenia";
  content: string;
}

export interface DiscussionInput {
  /** Sorte de discussion : une note rapide a son propre prompt (`note`). */
  kind?: DiscussionKind;
  /** Page d'où la discussion a été ouverte, s'il y en a une. */
  page?: DiscussionPage;
  related: readonly RelatedPage[];
  /** Sources de la bibliothèque, que l'assistante peut recommander. */
  sources?: readonly RelatedPage[];
  history: readonly DiscussionTurn[];
}

export { EUGENIA_LINK_PREFIX } from "../constants.ts";

function pagesList(pages: readonly RelatedPage[]): string {
  return pages
    .map(
      (r) =>
        `- ${r.id} | ${r.title}${r.description ? ` | ${excerpt(r.description, 200).replace(/\n+/g, " ")}` : ""}`,
    )
    .join("\n");
}

export function discussionRequest(context: TaskContext, input: DiscussionInput): GenerateRequest {
  const page = input.page;
  const parts = [systemPrompt(context, input.kind === "note" ? "note" : "discuss"), ""];
  if (page) {
    parts.push(
      "<page>",
      `Identifiant : ${page.id}`,
      `Titre : ${page.title}`,
      `Type : ${page.type}`,
      `Chemin : ${[...page.path, page.title].join(" > ")}`,
      "",
      excerpt(page.content, 30000),
      "</page>",
    );
  }
  parts.push(`<pages_liees>\n${pagesList(input.related) || "(aucune)"}\n</pages_liees>`);
  if (input.sources) {
    parts.push(`<bibliotheque>\n${pagesList(input.sources) || "(aucune source)"}\n</bibliotheque>`);
  }
  const messages: ChatMessage[] = input.history.map((turn) => ({
    role: turn.role === "user" ? "user" : "assistant",
    content: turn.content,
  }));
  return withSignal(context, {
    system: parts.join("\n"),
    messages,
    effort: "medium" as const,
    cache: true,
  });
}

export function streamDiscussion(
  context: TaskContext,
  input: DiscussionInput,
): AsyncIterable<string> {
  return context.provider.stream(discussionRequest(context, input));
}

/** Identifiants cités par Eugenia (`eugenia:ID`) dans un texte. */
export function citedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\]\(eugenia:([^)\s]+)\)/g)) ids.add(match[1]!);
  return [...ids];
}
