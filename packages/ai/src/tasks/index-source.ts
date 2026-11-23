/**
 * Indexing a source (§8.6): a large model (Mistral Large by default) reads the whole text of a
 * source once and describes it as a knowledge tree, stored in `_tree.json`. Eugenia then reads
 * this tree at low cost, even with a smaller model, instead of the source.
 *
 * A long source is read in parts: each part gets its own tree, then the model gathers the main
 * topics of the parts into the top of the tree of the whole source. A part whose tree is cut off
 * (maximum answer length) is split in two and read again.
 */
import { z } from "zod";
import type { KnowledgeNode } from "@openeugenia/core";
import { AIError } from "../errors.ts";
import { excerpt, splitText, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export const KnowledgeNodeSchema = z.object({
  name: z.string(),
  description: z.string(),
  get children(): z.ZodArray<typeof KnowledgeNodeSchema> {
    return z.array(KnowledgeNodeSchema);
  },
});

export const AssemblySchema = z.object({
  name: z.string(),
  description: z.string(),
  groups: z.array(
    z.object({ name: z.string(), description: z.string(), members: z.array(z.string()) }),
  ),
});

export interface IndexSourceInput {
  title: string;
  /** Text of the source: its record, then its content in Markdown. */
  text: string;
}

export interface IndexProgress {
  /** Parts read so far, out of the total (which grows if a part has to be split). */
  done: number;
  total: number;
  /** The topics of the parts are being gathered. */
  assembling?: boolean;
}

export interface IndexSourceOptions {
  /** Maximum size of a part, in characters (default: 60,000, about 15,000 tokens). */
  partSize?: number;
  /** Below this size, a part cut off is not split again (default: 6,000). */
  minPartSize?: number;
  /** Maximum length of an answer, in tokens (default: 32,000). */
  maxTokens?: number;
  /** Parts read at the same time (default: 3). */
  concurrency?: number;
  onProgress?(progress: IndexProgress): void;
}

const DEFAULT_PART_SIZE = 60_000;
const DEFAULT_MIN_PART_SIZE = 6_000;
const DEFAULT_MAX_TOKENS = 32_000;

function isTruncation(error: unknown): boolean {
  return error instanceof AIError && error.kind === "invalid_output";
}

function normalizedName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Merges the nodes that have the same name (their children are put together). */
export function mergeDuplicates(nodes: readonly KnowledgeNode[]): KnowledgeNode[] {
  const out: KnowledgeNode[] = [];
  const byName = new Map<string, KnowledgeNode>();
  for (const node of nodes) {
    const key = normalizedName(node.name);
    const existing = key ? byName.get(key) : undefined;
    if (!existing) {
      const copy = { ...node, children: [...node.children] };
      out.push(copy);
      if (key) byName.set(key, copy);
      continue;
    }
    if (node.description && !existing.description.includes(node.description)) {
      existing.description = existing.description
        ? `${existing.description}\n\n${node.description}`
        : node.description;
    }
    existing.children = mergeDuplicates([...existing.children, ...node.children]);
  }
  return out;
}

/**
 * Top of the tree of a source read in parts. `plan` is Eugenia's answer: the root and the
 * groups of topics of the parts (`P<part>.<topic>`). A topic left out of every group is kept,
 * in the order of the source.
 */
export function assembleTree(
  title: string,
  trees: readonly KnowledgeNode[],
  plan: z.infer<typeof AssemblySchema> | null,
): KnowledgeNode {
  const topics = new Map<string, KnowledgeNode>();
  trees.forEach((tree, p) => {
    const items = tree.children.length > 0 ? tree.children : [tree];
    items.forEach((node, i) => topics.set(`P${p + 1}.${i + 1}`, node));
  });
  const used = new Set<string>();
  const children: KnowledgeNode[] = [];
  for (const group of plan?.groups ?? []) {
    const members = group.members
      .map((id) => id.trim().toUpperCase())
      .filter((id) => topics.has(id) && !used.has(id));
    for (const id of members) used.add(id);
    if (members.length === 0) continue;
    const nodes = mergeDuplicates(members.map((id) => topics.get(id)!));
    children.push(
      nodes.length === 1
        ? nodes[0]!
        : {
            name: group.name.trim() || nodes[0]!.name,
            description: group.description,
            children: nodes,
          },
    );
  }
  const left = [...topics].filter(([id]) => !used.has(id)).map(([, node]) => node);
  const description =
    plan?.description.trim() ||
    trees
      .map((t) => t.description)
      .filter(Boolean)
      .join("\n\n");
  return {
    name: plan?.name.trim() || title,
    description,
    children: mergeDuplicates([...children, ...left]),
  };
}

function partsBlock(trees: readonly KnowledgeNode[]): string {
  return trees
    .map((tree, p) => {
      const items = tree.children.length > 0 ? tree.children : [tree];
      const lines = items.map(
        (node, i) =>
          `- P${p + 1}.${i + 1} | ${node.name} | ${excerpt(node.description, 400).replace(/\n+/g, " ")}`,
      );
      return [
        `Part ${p + 1}: ${tree.name} — ${excerpt(tree.description, 600).replace(/\n+/g, " ")}`,
        ...lines,
      ].join("\n");
    })
    .join("\n\n");
}

/** Knowledge tree of a source. */
export async function indexSource(
  context: TaskContext,
  input: IndexSourceInput,
  options: IndexSourceOptions = {},
): Promise<KnowledgeNode> {
  const system = systemPrompt(context, "index-source");
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const minPartSize = options.minPartSize ?? DEFAULT_MIN_PART_SIZE;
  const progress = { done: 0, total: 0 };
  const report = (assembling = false): void =>
    options.onProgress?.(assembling ? { ...progress, assembling } : { ...progress });

  const treeOf = (text: string, part?: string): Promise<KnowledgeNode> =>
    context.provider.json(
      withSignal(context, {
        system,
        messages: [
          {
            role: "user" as const,
            content: [
              "<step>tree</step>",
              `<title>${input.title}</title>`,
              part ? `<part>${part}</part>` : "",
              `<source>\n${text}\n</source>`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        schema: KnowledgeNodeSchema,
        name: "knowledge_tree",
        maxTokens,
        effort: "high" as const,
      }),
    );

  const assemble = async (trees: KnowledgeNode[]): Promise<KnowledgeNode> => {
    report(true);
    let plan: z.infer<typeof AssemblySchema> | null = null;
    try {
      plan = await context.provider.json(
        withSignal(context, {
          system,
          messages: [
            {
              role: "user" as const,
              content: [
                "<step>assemble</step>",
                `<title>${input.title}</title>`,
                `<parts>\n${partsBlock(trees)}\n</parts>`,
              ].join("\n"),
            },
          ],
          schema: AssemblySchema,
          name: "assembly",
          maxTokens,
          effort: "medium" as const,
        }),
      );
    } catch (error) {
      // Without a plan, the topics of the parts are kept in their order.
      if (!(error instanceof AIError && error.kind === "invalid_output")) throw error;
    }
    return assembleTree(input.title, trees, plan);
  };

  const readPart = async (text: string, part?: string): Promise<KnowledgeNode> => {
    try {
      const tree = await treeOf(text, part);
      progress.done++;
      report();
      return tree;
    } catch (error) {
      if (!isTruncation(error) || text.length <= minPartSize) throw error;
      // Too much to describe at once: two halves, read one after the other.
      const halves = splitText(text, Math.ceil(text.length / 2) + 1).map((c) => c.text);
      progress.total += halves.length - 1;
      report();
      const trees: KnowledgeNode[] = [];
      for (const [i, half] of halves.entries()) {
        trees.push(await readPart(half, `${part ? `${part}, ` : ""}${i + 1} of ${halves.length}`));
      }
      return assemble(trees);
    }
  };

  const parts = splitText(input.text.trim(), options.partSize ?? DEFAULT_PART_SIZE).map(
    (c) => c.text,
  );
  progress.total = parts.length;
  report();
  if (parts.length === 1) return readPart(parts[0]!);
  // The parts are independent: several are read at the same time, in their order.
  const trees: KnowledgeNode[] = new Array<KnowledgeNode>(parts.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < parts.length) {
      const i = next++;
      trees[i] = await readPart(parts[i]!, `${i + 1} of ${parts.length}`);
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 3, parts.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return assemble(trees);
}
