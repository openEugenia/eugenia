/**
 * Categories of the knowledge extracted from one document (§8.1). Eugenia looks at the
 * existing categories and at all the items of the document together, then files them the way
 * Wikipedia would: in existing categories when they fit exactly, otherwise in new categories
 * (possibly nested) that group the items of the document sharing a topic.
 */
import { z } from "zod";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";
import type { CategoryOption } from "./extract.ts";

export const CategorizationSchema = z.object({
  new_categories: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      parent: z.string(),
      reason: z.string(),
    }),
  ),
  assignments: z.array(z.object({ item: z.number().int(), category: z.string() })),
});

/** A category to create, proposed by Eugenia (or added by the user). */
export interface PlannedCategory {
  /** Key of the category in the plan (never an identifier of an existing category). */
  key: string;
  title: string;
  /** Identifier of an existing category, or key of another planned category. */
  parent: string;
  reason?: string;
}

export interface CategoryPlan {
  /** Categories to create, each one after its planned parent. */
  newCategories: PlannedCategory[];
  /** Category of each knowledge item, in input order: an existing identifier or a planned key. */
  assignments: string[];
}

export interface CategorizeInput {
  /** Title of the document the knowledge was extracted from. */
  document: string;
  /** Excerpt of the document, for context. */
  excerpt?: string;
  categories: readonly CategoryOption[];
  knowledge: readonly { title: string; knowledge: string }[];
  /** Category used when Eugenia gives none, or an unknown one. */
  fallbackId: string;
}

/** Prefix of the keys of planned categories, so that they never collide with identifiers. */
export const PLANNED_PREFIX = "new:";

function categoriesBlock(categories: readonly CategoryOption[]): string {
  return categories
    .map(
      (c) =>
        `- ${c.id} | ${c.path}${c.description ? ` | ${excerpt(c.description, 160).replace(/\n+/g, " ")}` : ""}`,
    )
    .join("\n");
}

const normalizeTitle = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Checks Eugenia's answer against the tree: unknown parents and categories fall back on
 * `fallbackId`, a new category that duplicates an existing sibling (or another new one) is
 * merged with it, cycles are broken, and categories that end up empty are dropped.
 */
export function resolveCategoryPlan(
  raw: z.infer<typeof CategorizationSchema>,
  input: Pick<CategorizeInput, "categories" | "knowledge" | "fallbackId">,
): CategoryPlan {
  const existing = new Map(input.categories.map((c) => [c.id, c]));
  const fallback = existing.has(input.fallbackId)
    ? input.fallbackId
    : (input.categories[0]?.id ?? input.fallbackId);
  // Titles of the existing children of each category, to spot duplicates.
  const byPath = new Map(input.categories.map((c) => [c.path, c.id]));
  const childByTitle = new Map<string, string>();
  for (const c of input.categories) {
    const parts = c.path.split(" > ");
    const parent = byPath.get(parts.slice(0, -1).join(" > "));
    if (parent) childByTitle.set(`${parent}|${normalizeTitle(parts.at(-1) ?? "")}`, c.id);
  }

  // 1. Keys: unique, prefixed; titles: trimmed, non-empty.
  const alias = new Map<string, string>();
  const planned = new Map<string, PlannedCategory>();
  for (const c of raw.new_categories) {
    const title = c.title.trim();
    if (!title || alias.has(c.key) || existing.has(c.key)) continue;
    const key = `${PLANNED_PREFIX}${planned.size + 1}`;
    alias.set(c.key, key);
    const category: PlannedCategory = { key, title, parent: c.parent.trim() };
    if (c.reason.trim()) category.reason = c.reason.trim();
    planned.set(key, category);
  }
  const target = (id: string): string | undefined => (existing.has(id) ? id : alias.get(id));

  // 2. Parents: known, otherwise the fallback; cycles broken.
  for (const category of planned.values()) {
    const parent = target(category.parent);
    category.parent = parent && parent !== category.key ? parent : fallback;
  }
  for (const category of planned.values()) {
    const seen = new Set([category.key]);
    let parent = planned.get(category.parent);
    while (parent) {
      if (seen.has(parent.key)) {
        category.parent = fallback;
        break;
      }
      seen.add(parent.key);
      parent = planned.get(parent.parent);
    }
  }

  // 3. Duplicates: a new category named like an existing sibling, or like another new one.
  const merged = new Map<string, string>();
  const resolve = (id: string): string => {
    let current = id;
    while (merged.has(current)) current = merged.get(current)!;
    return current;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const seenTitles = new Map<string, string>();
    for (const category of planned.values()) {
      if (merged.has(category.key)) continue;
      category.parent = resolve(category.parent);
      const id = `${category.parent}|${normalizeTitle(category.title)}`;
      const twin = childByTitle.get(id) ?? seenTitles.get(id);
      if (twin) {
        merged.set(category.key, twin);
        changed = true;
      } else {
        seenTitles.set(id, category.key);
      }
    }
  }
  for (const key of merged.keys()) planned.delete(key);
  for (const category of planned.values()) category.parent = resolve(category.parent);

  // 4. Assignments: one category per item, known, otherwise the fallback.
  const assignments = input.knowledge.map(() => fallback);
  for (const a of raw.assignments) {
    const index = a.item - 1;
    if (index < 0 || index >= assignments.length) continue;
    const id = target(a.category.trim());
    if (id) assignments[index] = resolve(id);
  }

  // 5. Only keep the planned categories that contain an item, directly or below.
  const used = new Set<string>();
  for (const id of assignments) {
    let category = planned.get(id);
    while (category && !used.has(category.key)) {
      used.add(category.key);
      category = planned.get(category.parent);
    }
  }
  return {
    newCategories: orderPlanned([...planned.values()].filter((c) => used.has(c.key))),
    assignments,
  };
}

/** Planned categories ordered so that each one comes after its planned parent. */
export function orderPlanned(categories: readonly PlannedCategory[]): PlannedCategory[] {
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const out: PlannedCategory[] = [];
  const placed = new Set<string>();
  const place = (category: PlannedCategory, depth: number): void => {
    if (placed.has(category.key) || depth > categories.length) return;
    const parent = byKey.get(category.parent);
    if (parent) place(parent, depth + 1);
    placed.add(category.key);
    out.push(category);
  };
  for (const category of categories) place(category, 0);
  return out;
}

/** Eugenia files the knowledge of one document, creating the categories that group it best. */
export async function categorizeKnowledge(
  context: TaskContext,
  input: CategorizeInput,
): Promise<CategoryPlan> {
  if (input.knowledge.length === 0) return { newCategories: [], assignments: [] };
  const items = input.knowledge
    .map((k, i) => `${i + 1}. ${k.title}: ${excerpt(k.knowledge, 400).replace(/\n+/g, " ")}`)
    .join("\n");
  const document = [
    `Title: ${input.document}`,
    input.excerpt?.trim() ? `Excerpt:\n${excerpt(input.excerpt, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await context.provider.json(
    withSignal(context, {
      system: systemPrompt(context, "categorize"),
      messages: [
        {
          role: "user" as const,
          content: [
            `<document>\n${document}\n</document>`,
            `<categories>\n${categoriesBlock(input.categories)}\n</categories>`,
            `<knowledge>\n${items}\n</knowledge>`,
          ].join("\n"),
        },
      ],
      schema: CategorizationSchema,
      name: "categorization",
      effort: "high" as const,
    }),
  );
  return resolveCategoryPlan(raw, input);
}
