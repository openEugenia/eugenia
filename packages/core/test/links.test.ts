import { describe, expect, it } from "vitest";
import {
  directoryMapper,
  relativePath,
  resolveLinkTarget,
  rewriteLinksForMove,
  scanLinks,
  unlinkTargets,
  markdownToText,
  boldParts,
} from "../src/index.ts";

describe("link scanning", () => {
  it("finds destinations and their positions", () => {
    const text =
      'See [**Lilith**](../lilith/index.md "title") and ![img](a b.png) and <https://x.org>.';
    const { links } = scanLinks(text);
    expect(links.map((l) => [l.kind, l.raw, l.label])).toEqual([
      ["link", "../lilith/index.md", "**Lilith**"],
    ]);
    const first = links[0]!;
    expect(text.slice(first.destStart, first.destEnd)).toBe("../lilith/index.md");
  });

  it("handles angle brackets, parentheses and definitions", () => {
    const text = "[a](<my folder/index.md>) [b](x_(1).md)\n\n[ref]: ../c/index.md\n";
    const { links } = scanLinks(text);
    expect(links.map((l) => l.raw)).toEqual(["my folder/index.md", "x_(1).md", "../c/index.md"]);
  });

  it("ignores links in code", () => {
    expect(scanLinks("`[a](b.md)`\n\n```\n[c](d.md)\n```\n").links).toEqual([]);
  });
});

describe("resolution", () => {
  it("resolves relative links and ignores external links", () => {
    expect(resolveLinkTarget("wiki/a/index.md", "../b/index.md#x")).toEqual({
      path: "wiki/b/index.md",
      hash: "#x",
      trailingSlash: false,
    });
    expect(resolveLinkTarget("wiki/a/index.md", "https://example.org")).toBeNull();
    expect(resolveLinkTarget("wiki/a/index.md", "#section")).toBeNull();
    expect(resolveLinkTarget("wiki/index.md", "../../outside.md")).toBeNull();
    expect(resolveLinkTarget("wiki/a/index.md", "my%20file.pdf")?.path).toBe("wiki/a/my file.pdf");
  });

  it("computes relative paths", () => {
    expect(relativePath("wiki/a", "wiki/b/index.md")).toBe("../b/index.md");
    expect(relativePath("wiki/a", "wiki/a/c/index.md")).toBe("c/index.md");
    expect(relativePath("wiki/a/b", "wiki/index.md")).toBe("../../index.md");
  });
});

describe("rewriting", () => {
  it("rewrites the links of a moved file and to a moved target", () => {
    const map = directoryMapper("wiki/a/c", "wiki/b/c");
    // moved file: its outgoing links are recomputed
    expect(
      rewriteLinksForMove(
        "[Up](../index.md) [B](../../b/index.md)",
        "wiki/a/c/index.md",
        "wiki/b/c/index.md",
        map,
      ),
    ).toBe("[Up](../../a/index.md) [B](../../b/index.md)"); // still valid link: kept
    // file that stays: its links to the moved branch are recomputed
    expect(
      rewriteLinksForMove("[C](../a/c/index.md#x)", "wiki/b/index.md", "wiki/b/index.md", map),
    ).toBe("[C](c/index.md#x)");
    // unrelated link: unchanged, even if written differently
    expect(
      rewriteLinksForMove("[Z](./z/index.md)", "wiki/b/index.md", "wiki/b/index.md", map),
    ).toBe("[Z](./z/index.md)");
  });

  it("replaces links to unpublished targets with text", () => {
    const text =
      "[Public](../pub/index.md), [Private](../priv/index.md) and ![photo](../priv/p.png) [r][x]\n\n[x]: ../priv/index.md\n";
    const out = unlinkTargets(text, "wiki/a/index.md", (t) => t.startsWith("wiki/priv"));
    expect(out).toBe("[Public](../pub/index.md), Private and photo r\n\n");
  });

  it("extracts plain text and bold parts", () => {
    expect(markdownToText("# Title\n\nSome **bold** and a [link](x.md).\n\n- a\n- b")).toBe(
      "Title\nSome bold and a link.\na\nb",
    );
    expect(boldParts("**Lilith** is a demon, **inspired** by a deity")).toEqual([
      "Lilith",
      "inspired",
    ]);
  });
});
