/**
 * Questions about the tree (§8.5): Eugenia first reads the top-level descriptions of the
 * scope, picks the relevant branches, goes down to the contents, then answers citing the
 * pages she used.
 */
import { z } from "zod";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";
import { citedIds } from "./discuss.ts";

export const ExplorationSchema = z.object({
  explore: z.array(z.string()),
  read: z.array(z.string()),
  enough: z.boolean(),
});

export interface TreeEntry {
  id: string;
  title: string;
  type: string;
  description?: string;
  hasChildren: boolean;
}

/** Access to the tree, provided by the application (web or CLI). */
export interface TreeNavigator {
  entry(id: string): TreeEntry | undefined;
  children(id: string): Promise<TreeEntry[]>;
  content(id: string): Promise<string>;
}

export type AskEvent =
  | { type: "explore"; ids: string[] }
  | { type: "read"; ids: string[] }
  | { type: "answer"; text: string }
  | { type: "done"; answer: string; cited: string[]; consulted: string[] };

export interface AskInput {
  question: string;
  scopeId: string;
  navigator: TreeNavigator;
  maxRounds?: number;
}

function pagesBlock(
  visible: ReadonlyMap<string, TreeEntry>,
  expanded: ReadonlySet<string>,
): string {
  return [...visible.values()]
    .map((e) => {
      const children = e.hasChildren
        ? expanded.has(e.id)
          ? "children already shown"
          : "has children"
        : "no children";
      const description = e.description ? excerpt(e.description, 300).replace(/\n+/g, " ") : "";
      return `- ${e.id} | ${e.title} | ${e.type} | ${children}${description ? ` | ${description}` : ""}`;
    })
    .join("\n");
}

function readBlock(read: ReadonlyMap<string, { title: string; content: string }>): string {
  if (read.size === 0) return "(nothing yet)";
  return [...read]
    .map(([id, page]) => `### ${page.title} (${id})\n${excerpt(page.content, 6000)}`)
    .join("\n\n");
}

export async function* askTree(context: TaskContext, input: AskInput): AsyncGenerator<AskEvent> {
  const { navigator } = input;
  const visible = new Map<string, TreeEntry>();
  const expanded = new Set<string>([input.scopeId]);
  const read = new Map<string, { title: string; content: string }>();
  const scope = navigator.entry(input.scopeId);
  if (scope) visible.set(scope.id, scope);
  for (const entry of await navigator.children(input.scopeId)) visible.set(entry.id, entry);
  const system = systemPrompt(context, "ask");

  for (let round = 0; round < (input.maxRounds ?? 4); round++) {
    const decision = await context.provider.json(
      withSignal(context, {
        system,
        messages: [
          {
            role: "user" as const,
            content: [
              "<step>exploration</step>",
              `<question>\n${input.question}\n</question>`,
              `<pages>\n${pagesBlock(visible, expanded)}\n</pages>`,
              `<read>\n${readBlock(read)}\n</read>`,
            ].join("\n"),
          },
        ],
        schema: ExplorationSchema,
        name: "exploration",
        effort: "low" as const,
      }),
    );
    const toExplore = decision.explore
      .filter((id) => visible.get(id)?.hasChildren && !expanded.has(id))
      .slice(0, 4);
    const toRead = decision.read.filter((id) => visible.has(id) && !read.has(id)).slice(0, 6);
    if (toExplore.length > 0) {
      yield { type: "explore", ids: toExplore };
      for (const id of toExplore) {
        expanded.add(id);
        for (const entry of await navigator.children(id)) visible.set(entry.id, entry);
      }
    }
    if (toRead.length > 0) {
      yield { type: "read", ids: toRead };
      for (const id of toRead) {
        read.set(id, { title: visible.get(id)?.title ?? id, content: await navigator.content(id) });
      }
    }
    if (decision.enough || (toExplore.length === 0 && toRead.length === 0)) break;
  }

  let answer = "";
  const stream = context.provider.stream(
    withSignal(context, {
      system,
      messages: [
        {
          role: "user" as const,
          content: [
            "<step>answer</step>",
            `<question>\n${input.question}\n</question>`,
            `<pages>\n${pagesBlock(visible, expanded)}\n</pages>`,
            `<read>\n${readBlock(read)}\n</read>`,
          ].join("\n"),
        },
      ],
      effort: "medium" as const,
    }),
  );
  for await (const text of stream) {
    answer += text;
    yield { type: "answer", text };
  }
  yield {
    type: "done",
    answer,
    cited: citedIds(answer).filter((id) => visible.has(id) || read.has(id)),
    consulted: [...read.keys()],
  };
}
