/**
 * Questions about the tree (§8.5). The tree is the common hierarchy of the wiki: categories,
 * knowledge items, the library sources filed in them (and the sections of their index), the
 * discussions placed in them. Two searches feed Eugenia:
 *
 * - **tree search**: she reads the descriptions of the scope, picks the relevant branches and
 *   goes down to the contents (a source goes down into the sections of its index);
 * - **exhaustive search**: the elements closest in meaning to the question (embeddings), found
 *   by the application, are shown to her from the start.
 *
 * She then answers from what she read only, citing it.
 */
import { z } from "zod";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";
import { citedIds } from "./discuss.ts";

export const ExplorationSchema = z.object({
  explore: z.array(z.string()),
  read: z.array(z.string()),
  enough: z.boolean(),
});

/** Element of the common hierarchy, as shown to Eugenia. */
export interface TreeEntry {
  id: string;
  title: string;
  /** category, knowledge, flashcard, source, section (of a source index), discussion… */
  type: string;
  description?: string;
  hasChildren: boolean;
  /** Titles of the enclosing elements, from the root (shown for elements found by meaning). */
  path?: string[];
  /** Closeness in meaning to the question, for an element found by the exhaustive search. */
  score?: number;
}

/** Access to the common hierarchy, provided by the application (web or CLI). */
export interface TreeNavigator {
  /** Page of the tree (synchronous). */
  entry(id: string): TreeEntry | undefined;
  /** Any element (page, section of a source index, discussion), with its path. */
  resolve(id: string): Promise<TreeEntry | undefined>;
  children(id: string): Promise<TreeEntry[]>;
  content(id: string): Promise<string>;
}

/** Element found by meaning (exhaustive search). */
export interface Candidate {
  id: string;
  score: number;
}

export type AskEvent =
  | { type: "found"; ids: string[] }
  | { type: "explore"; ids: string[] }
  | { type: "read"; ids: string[] }
  | { type: "answer"; text: string }
  | { type: "done"; answer: string; cited: string[]; consulted: string[] };

export interface AskInput {
  question: string;
  scopeId: string;
  navigator: TreeNavigator;
  /** Elements closest in meaning to the question, best first, already limited to the scope. */
  candidates?: readonly Candidate[];
  /** Number of candidates read right away, before the first exploration round. */
  autoRead?: number;
  maxRounds?: number;
}

/** Element read by Eugenia: the knowledge her answer is based on. */
export interface KnowledgeExcerpt {
  id: string;
  title: string;
  type: string;
  path?: string[];
  content: string;
}

interface Exploration {
  visible: Map<string, TreeEntry>;
  expanded: Set<string>;
  read: Map<string, KnowledgeExcerpt>;
}

const MAX_EXPLORE = 4;
const MAX_READ = 6;

function entryLine(e: TreeEntry, expanded: ReadonlySet<string>): string {
  const children = e.hasChildren
    ? expanded.has(e.id)
      ? "children already shown"
      : "has children"
    : "no children";
  const parts = [e.id, e.title, e.type, children];
  if (e.path?.length) parts.push(`in: ${e.path.join(" › ")}`);
  if (e.score !== undefined) parts.push(`found by meaning (${Math.round(e.score * 100)}%)`);
  const description = e.description ? excerpt(e.description, 300).replace(/\n+/g, " ") : "";
  if (description) parts.push(description);
  return `- ${parts.join(" | ")}`;
}

function pagesBlock(exploration: Exploration): string {
  return [...exploration.visible.values()]
    .map((e) => entryLine(e, exploration.expanded))
    .join("\n");
}

function readBlock(read: ReadonlyMap<string, KnowledgeExcerpt>): string {
  if (read.size === 0) return "(nothing yet)";
  return [...read.values()].map(knowledgeBlock).join("\n\n");
}

/** One element read, for Eugenia: title, type, place in the hierarchy, content. */
export function knowledgeBlock(k: KnowledgeExcerpt): string {
  const where = k.path?.length ? `\nIn: ${k.path.join(" › ")}` : "";
  return `### ${k.title} (${k.type}, ${k.id})${where}\n${excerpt(k.content, 6000)}`;
}

async function readEntries(
  navigator: TreeNavigator,
  exploration: Exploration,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    const entry = exploration.visible.get(id);
    if (!entry || exploration.read.has(id)) continue;
    const k: KnowledgeExcerpt = {
      id,
      title: entry.title,
      type: entry.type,
      content: await navigator.content(id),
    };
    if (entry.path) k.path = entry.path;
    exploration.read.set(id, k);
  }
}

/** Shows the children of an element, each with its place in the hierarchy. */
async function showChildren(
  navigator: TreeNavigator,
  exploration: Exploration,
  id: string,
): Promise<void> {
  const parent = exploration.visible.get(id);
  for (const entry of await navigator.children(id)) {
    if (exploration.visible.get(entry.id)?.score !== undefined) continue;
    const path = entry.path ?? (parent ? [...(parent.path ?? []), parent.title] : undefined);
    exploration.visible.set(entry.id, path ? { ...entry, path } : entry);
  }
}

async function* explore(
  context: TaskContext,
  input: AskInput,
  exploration: Exploration,
  system: string,
): AsyncGenerator<AskEvent> {
  const { navigator } = input;
  const scope = (await navigator.resolve(input.scopeId)) ?? navigator.entry(input.scopeId);
  if (scope) exploration.visible.set(scope.id, scope);
  await showChildren(navigator, exploration, input.scopeId);
  // Exhaustive search: the elements closest in meaning are visible from the start.
  const found: string[] = [];
  for (const candidate of input.candidates ?? []) {
    const entry = await navigator.resolve(candidate.id);
    if (!entry) continue;
    exploration.visible.set(entry.id, { ...entry, score: candidate.score });
    found.push(entry.id);
  }
  if (found.length > 0) yield { type: "found", ids: found };
  const first = found.slice(0, input.autoRead ?? 0);
  if (first.length > 0) {
    yield { type: "read", ids: first };
    await readEntries(navigator, exploration, first);
  }

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
              `<pages>\n${pagesBlock(exploration)}\n</pages>`,
              `<read>\n${readBlock(exploration.read)}\n</read>`,
            ].join("\n"),
          },
        ],
        schema: ExplorationSchema,
        name: "exploration",
        effort: "low" as const,
      }),
    );
    const toExplore = decision.explore
      .filter((id) => exploration.visible.get(id)?.hasChildren && !exploration.expanded.has(id))
      .slice(0, MAX_EXPLORE);
    const toRead = decision.read
      .filter((id) => exploration.visible.has(id) && !exploration.read.has(id))
      .slice(0, MAX_READ);
    if (toExplore.length > 0) {
      yield { type: "explore", ids: toExplore };
      for (const id of toExplore) {
        exploration.expanded.add(id);
        await showChildren(navigator, exploration, id);
      }
    }
    if (toRead.length > 0) {
      yield { type: "read", ids: toRead };
      await readEntries(navigator, exploration, toRead);
    }
    if (decision.enough || (toExplore.length === 0 && toRead.length === 0)) break;
  }
}

function newExploration(scopeId: string): Exploration {
  return { visible: new Map(), expanded: new Set([scopeId]), read: new Map() };
}

export async function* askTree(context: TaskContext, input: AskInput): AsyncGenerator<AskEvent> {
  const system = systemPrompt(context, "ask");
  const exploration = newExploration(input.scopeId);
  yield* explore(context, input, exploration, system);

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
            `<pages>\n${pagesBlock(exploration)}\n</pages>`,
            `<read>\n${readBlock(exploration.read)}\n</read>`,
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
    // Only what was read can be cited: the answer is based on it.
    cited: citedIds(answer).filter((id) => exploration.read.has(id)),
    consulted: [...exploration.read.keys()],
  };
}

/**
 * Knowledge of the tree relevant to a message, for an answer based on the tree only
 * (discussions): the same search as for a question, without the answer.
 */
export async function gatherKnowledge(
  context: TaskContext,
  input: AskInput,
  onEvent?: (event: AskEvent) => void,
): Promise<KnowledgeExcerpt[]> {
  const exploration = newExploration(input.scopeId);
  for await (const event of explore(context, input, exploration, systemPrompt(context, "ask"))) {
    onEvent?.(event);
  }
  return [...exploration.read.values()];
}
