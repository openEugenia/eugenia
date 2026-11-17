/** Discussions avec Eugenia à partir d'une page (§8.4). */
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

export { EUGENIA_LINK_PREFIX } from "../constants.ts";

export function discussionRequest(
  context: TaskContext,
  input: {
    page: DiscussionPage;
    related: readonly RelatedPage[];
    history: readonly DiscussionTurn[];
  },
): GenerateRequest {
  const page = input.page;
  const related = input.related
    .map(
      (r) =>
        `- ${r.id} | ${r.title}${r.description ? ` | ${excerpt(r.description, 200).replace(/\n+/g, " ")}` : ""}`,
    )
    .join("\n");
  const system = [
    systemPrompt(context, "discuss"),
    "",
    "<page>",
    `Identifiant : ${page.id}`,
    `Titre : ${page.title}`,
    `Type : ${page.type}`,
    `Chemin : ${[...page.path, page.title].join(" > ")}`,
    "",
    excerpt(page.content, 30000),
    "</page>",
    `<pages_liees>\n${related || "(aucune)"}\n</pages_liees>`,
  ].join("\n");
  const messages: ChatMessage[] = input.history.map((turn) => ({
    role: turn.role === "user" ? "user" : "assistant",
    content: turn.content,
  }));
  return withSignal(context, { system, messages, effort: "medium" as const, cache: true });
}

export function streamDiscussion(
  context: TaskContext,
  input: {
    page: DiscussionPage;
    related: readonly RelatedPage[];
    history: readonly DiscussionTurn[];
  },
): AsyncIterable<string> {
  return context.provider.stream(discussionRequest(context, input));
}

/** Identifiants cités par Eugenia (`eugenia:ID`) dans un texte. */
export function citedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\]\(eugenia:([^)\s]+)\)/g)) ids.add(match[1]!);
  return [...ids];
}
