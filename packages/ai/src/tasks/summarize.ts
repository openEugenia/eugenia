/** Sub-wiki descriptions and discussion summaries (§5.5, §8.4, §11.2). */
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export interface SummaryChildInput {
  title: string;
  type: string;
  /** Description of the child sub-wiki, or content of the page. */
  description: string;
  isSubwiki: boolean;
}

export interface SummaryInput {
  title: string;
  /** Titles of the ancestors, from the root to the parent. */
  path: readonly string[];
  content?: string;
  children: readonly SummaryChildInput[];
}

export function summaryMessage(input: SummaryInput): string {
  const children = input.children
    .map(
      (c) =>
        `- [${c.isSubwiki ? "sub-wiki" : c.type}] ${c.title}: ${excerpt(c.description || "(empty)", 1500).replace(/\n+/g, " ")}`,
    )
    .join("\n");
  return [
    "<mode>sub-wiki</mode>",
    "<page>",
    `Title: ${input.title}`,
    `Level: ${input.path.length === 0 ? "root of the wiki" : "branch"}`,
    `Path: ${[...input.path, input.title].join(" > ")}`,
    input.content?.trim() ? `Content:\n${excerpt(input.content, 4000)}` : "Content: (none)",
    "</page>",
    `<children>\n${children}\n</children>`,
  ].join("\n");
}

export async function summarizeNode(context: TaskContext, input: SummaryInput): Promise<string> {
  const text = await context.provider.complete(
    withSignal(context, {
      system: systemPrompt(context, "summarize"),
      messages: [{ role: "user" as const, content: summaryMessage(input) }],
      effort: "medium" as const,
    }),
  );
  return text.trim();
}

export interface DiscussionLine {
  role: "user" | "eugenia";
  content: string;
}

export async function summarizeDiscussion(
  context: TaskContext,
  input: { title: string; messages: readonly DiscussionLine[] },
): Promise<string> {
  const transcript = input.messages
    .map((m) => `${m.role === "user" ? "User" : "Eugenia"}: ${m.content}`)
    .join("\n\n");
  const text = await context.provider.complete(
    withSignal(context, {
      system: systemPrompt(context, "summarize"),
      messages: [
        {
          role: "user" as const,
          content: `<mode>discussion</mode>\n<title>${input.title}</title>\n<exchange>\n${excerpt(transcript, 80000)}\n</exchange>`,
        },
      ],
      effort: "medium" as const,
    }),
  );
  return text.trim();
}
