/**
 * Discussions with Eugenia (§8.4): free discussion from a page, or quick note (Eugenia
 * immediately answers with candidate knowledge and source leads).
 */
import type { DiscussionKind } from "@openeugenia/core";
import type { ChatMessage, GenerateRequest } from "../types.ts";
import { knowledgeBlock, type KnowledgeExcerpt } from "./ask.ts";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export interface DiscussionPage {
  id: string;
  title: string;
  type: string;
  /** Titles of the ancestors. */
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
  /** Discussion kind: a quick note has its own prompt (`note`). */
  kind?: DiscussionKind;
  /** Page the discussion was opened from, if any. */
  page?: DiscussionPage;
  related: readonly RelatedPage[];
  /** Library sources, which the assistant may recommend. */
  sources?: readonly RelatedPage[];
  /**
   * Knowledge of the tree found for the last message (wiki, sources and their index,
   * discussions): Eugenia's answer is based on it only.
   */
  knowledge?: readonly KnowledgeExcerpt[];
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
      `Identifier: ${page.id}`,
      `Title: ${page.title}`,
      `Type: ${page.type}`,
      `Path: ${[...page.path, page.title].join(" > ")}`,
      "",
      excerpt(page.content, 30000),
      "</page>",
    );
  }
  parts.push(`<related_pages>\n${pagesList(input.related) || "(none)"}\n</related_pages>`);
  if (input.sources) {
    parts.push(`<library>\n${pagesList(input.sources) || "(no source)"}\n</library>`);
  }
  parts.push(
    `<knowledge>\n${
      input.knowledge?.length
        ? input.knowledge.map(knowledgeBlock).join("\n\n")
        : "(nothing found in the wiki for this message)"
    }\n</knowledge>`,
  );
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

/** Identifiers cited by Eugenia (`eugenia:ID`) in a text. */
export function citedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\]\(eugenia:([^)\s]+)\)/g)) ids.add(match[1]!);
  return [...ids];
}
