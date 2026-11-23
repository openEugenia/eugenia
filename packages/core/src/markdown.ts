/**
 * Markdown analysis (mdast / micromark): links with their exact positions, rewriting of
 * destinations without reformatting the rest of the text, plain-text extraction.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes, Root } from "mdast";

export type LinkKind = "link" | "image" | "definition";

export interface MarkdownLink {
  kind: LinkKind;
  /** Destination as decoded by the parser. */
  url: string;
  /** Raw destination in the source (without angle brackets). */
  raw: string;
  /** Position of the raw destination in the source. */
  destStart: number;
  destEnd: number;
  /** Position of the whole construct (`[text](url)`, `![alt](src)`, `[id]: url`). */
  start: number;
  end: number;
  /** Raw label text (link text, alternative text or identifier). */
  label: string;
  /** Normalized identifier (reference definitions). */
  identifier?: string;
}

export interface MarkdownReference {
  kind: "linkReference" | "imageReference";
  identifier: string;
  start: number;
  end: number;
  label: string;
}

export interface LinkScan {
  links: MarkdownLink[];
  references: MarkdownReference[];
}

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text);
}

/** Position of the `]` closing a label opened at `from` (after the `[`), or -1. */
function findLabelEnd(text: string, from: number, limit: number): number {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") {
      // Brackets inside inline code do not count.
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const close = text.indexOf(fence, i + ticks);
      if (close >= 0 && close < limit) {
        i = close + ticks - 1;
        continue;
      }
    }
    if (c === "[") depth++;
    else if (c === "]") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Destination of a link starting at `from` (right after `(` or `:`). */
function scanDestination(
  text: string,
  from: number,
  limit: number,
): { start: number; end: number } | null {
  let i = from;
  let newlines = 0;
  while (i < limit && /[ \t\r\n]/.test(text[i]!)) {
    if (text[i] === "\n") newlines++;
    i++;
  }
  if (newlines > 1 || i >= limit) return null;
  if (text[i] === "<") {
    const close = text.indexOf(">", i + 1);
    if (close < 0 || close > limit) return null;
    return { start: i + 1, end: close };
  }
  const start = i;
  let depth = 0;
  while (i < limit) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < limit) {
      i += 2;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (/\s/.test(c)) break;
    i++;
  }
  return i > start ? { start, end: i } : null;
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child as Nodes, visit);
}

/** Lists the links, images and definitions of a Markdown text, with their positions. */
export function scanLinks(text: string): LinkScan {
  const links: MarkdownLink[] = [];
  const references: MarkdownReference[] = [];
  let tree: Root;
  try {
    tree = fromMarkdown(text);
  } catch {
    return { links, references };
  }
  walk(tree, (node) => {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) return;
    const start = pos.start.offset;
    const end = pos.end.offset;
    if (node.type === "link") {
      if (text[start] !== "[") return; // autolink
      const labelEnd = findLabelEnd(text, start + 1, end);
      if (labelEnd < 0 || text[labelEnd + 1] !== "(") return;
      const dest = scanDestination(text, labelEnd + 2, end);
      if (!dest) return;
      links.push({
        kind: "link",
        url: node.url,
        raw: text.slice(dest.start, dest.end),
        destStart: dest.start,
        destEnd: dest.end,
        start,
        end,
        label: text.slice(start + 1, labelEnd),
      });
    } else if (node.type === "image") {
      if (text[start] !== "!" || text[start + 1] !== "[") return;
      const labelEnd = findLabelEnd(text, start + 2, end);
      if (labelEnd < 0 || text[labelEnd + 1] !== "(") return;
      const dest = scanDestination(text, labelEnd + 2, end);
      if (!dest) return;
      links.push({
        kind: "image",
        url: node.url,
        raw: text.slice(dest.start, dest.end),
        destStart: dest.start,
        destEnd: dest.end,
        start,
        end,
        label: node.alt ?? "",
      });
    } else if (node.type === "definition") {
      const open = text.indexOf("[", start);
      if (open < 0 || open >= end) return;
      const labelEnd = findLabelEnd(text, open + 1, end);
      if (labelEnd < 0 || text[labelEnd + 1] !== ":") return;
      const dest = scanDestination(text, labelEnd + 2, end);
      if (!dest) return;
      links.push({
        kind: "definition",
        url: node.url,
        raw: text.slice(dest.start, dest.end),
        destStart: dest.start,
        destEnd: dest.end,
        start,
        end,
        label: text.slice(open + 1, labelEnd),
        identifier: node.identifier,
      });
    } else if (node.type === "linkReference" || node.type === "imageReference") {
      const open = node.type === "imageReference" ? start + 1 : start;
      if (text[open] !== "[") return;
      const labelEnd = findLabelEnd(text, open + 1, end);
      if (labelEnd < 0) return;
      references.push({
        kind: node.type,
        identifier: node.identifier,
        start,
        end,
        label: node.type === "imageReference" ? (node.alt ?? "") : text.slice(open + 1, labelEnd),
      });
    }
  });
  links.sort((a, b) => a.start - b.start);
  references.sort((a, b) => a.start - b.start);
  return { links, references };
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) continue; // overlap: the enclosing edit wins
    out += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

/** Escapes a destination to write it in a Markdown link. */
export function formatDestination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : url;
}

/**
 * Rewrites link destinations. `rewrite` returns the new destination, or `undefined` to
 * leave the link untouched. The rest of the text is not modified.
 */
export function rewriteDestinations(
  text: string,
  rewrite: (link: MarkdownLink) => string | undefined,
): string {
  const { links } = scanLinks(text);
  const edits: Edit[] = [];
  for (const link of links) {
    const next = rewrite(link);
    if (next === undefined || next === link.raw) continue;
    // The raw destination may be in angle brackets: replace them too.
    const angle = text[link.destStart - 1] === "<" && text[link.destEnd] === ">";
    edits.push({
      start: angle ? link.destStart - 1 : link.destStart,
      end: angle ? link.destEnd + 1 : link.destEnd,
      text: formatDestination(next),
    });
  }
  return edits.length === 0 ? text : applyEdits(text, edits);
}

/**
 * Replaces with their plain text the links and images whose destination matches
 * `predicate` (including through a reference definition, which is removed).
 */
export function unlinkWhere(text: string, predicate: (link: MarkdownLink) => boolean): string {
  let current = text;
  for (let pass = 0; pass < 5; pass++) {
    const { links, references } = scanLinks(current);
    const edits: Edit[] = [];
    const removedIds = new Set<string>();
    for (const link of links) {
      if (!predicate(link)) continue;
      if (link.kind === "definition") {
        if (link.identifier) removedIds.add(link.identifier);
        let end = link.end;
        if (current[end] === "\n") end++;
        edits.push({ start: link.start, end, text: "" });
      } else {
        edits.push({ start: link.start, end: link.end, text: link.label });
      }
    }
    for (const ref of references) {
      if (removedIds.has(ref.identifier)) {
        edits.push({ start: ref.start, end: ref.end, text: ref.label });
      }
    }
    if (edits.length === 0) return current;
    current = applyEdits(current, edits);
  }
  return current;
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "code",
  "thematicBreak",
  "table",
  "tableRow",
]);

/** Plain text of a Markdown document (full-text search, excerpts). */
export function markdownToText(markdown: string): string {
  let tree: Root;
  try {
    tree = fromMarkdown(markdown);
  } catch {
    return markdown;
  }
  const parts: string[] = [];
  const visit = (node: Nodes): void => {
    switch (node.type) {
      case "text":
      case "inlineCode":
        parts.push(node.value);
        return;
      case "code":
        parts.push(`\n${node.value}\n`);
        return;
      case "image":
        if (node.alt) parts.push(node.alt);
        return;
      case "html":
        return;
      case "break":
        parts.push("\n");
        return;
      default:
        break;
    }
    if ("children" in node) {
      for (const child of node.children) visit(child as Nodes);
      if (BLOCK_TYPES.has(node.type)) parts.push("\n");
    }
  };
  visit(tree);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Text of the first paragraph (headings are ignored). */
export function firstParagraph(markdown: string): string {
  let tree: Root;
  try {
    tree = fromMarkdown(markdown);
  } catch {
    return markdown.trim().split(/\n\s*\n/)[0] ?? "";
  }
  for (const node of tree.children) {
    if (node.type === "paragraph" || node.type === "blockquote" || node.type === "list") {
      const pos = node.position;
      if (pos?.start.offset !== undefined && pos.end.offset !== undefined) {
        return markdownToText(markdown.slice(pos.start.offset, pos.end.offset));
      }
    }
  }
  return "";
}

/** Truncates a text to `max` characters at a word boundary, with an ellipsis. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "") + "…";
}

/** Bold parts of a statement: the learning targets of a flashcard (§5.7). */
export function boldParts(markdown: string): string[] {
  let tree: Root;
  try {
    tree = fromMarkdown(markdown);
  } catch {
    return [];
  }
  const out: string[] = [];
  walk(tree, (node) => {
    if (node.type === "strong") {
      const pos = node.position;
      if (pos?.start.offset !== undefined && pos.end.offset !== undefined) {
        const t = markdownToText(markdown.slice(pos.start.offset, pos.end.offset));
        if (t) out.push(t);
      }
    }
  });
  return out;
}
