import { describe, expect, it } from "vitest";
import {
  parseDocument,
  serializeDocument,
  parseConfig,
  serializeConfig,
  serializePublicConfig,
} from "../src/index.ts";

describe("frontmatter", () => {
  it("reads the frontmatter and the body", () => {
    const doc = parseDocument("---\nid: 01AB\ntitle: Lilith\ntags: [a, b]\n---\n\nText\n");
    expect(doc.hasFrontmatter).toBe(true);
    expect(doc.data).toEqual({ id: "01AB", title: "Lilith", tags: ["a", "b"] });
    expect(doc.body).toBe("Text\n");
  });

  it("keeps ISO dates as strings", () => {
    const doc = parseDocument("---\ncreated: 2026-11-17T10:30:00Z\n---\n");
    expect(doc.data.created).toBe("2026-11-17T10:30:00Z");
  });

  it("accepts an empty frontmatter and a BOM", () => {
    expect(parseDocument("﻿---\n---\nBody").body).toBe("Body");
  });

  it("reports invalid YAML without throwing", () => {
    const doc = parseDocument("---\ntitle: [not closed\n---\nBody");
    expect(doc.error).toMatch(/Invalid YAML/);
    expect(doc.body).toBe("Body");
  });

  it("without a frontmatter, everything is body", () => {
    const doc = parseDocument("# Title\n");
    expect(doc.hasFrontmatter).toBe(false);
    expect(doc.body).toBe("# Title\n");
  });

  it("writes keys in order and omits empty values", () => {
    const text = serializeDocument(
      {
        custom: 1,
        title: "Lilith",
        id: "01AB",
        tags: ["x", "y"],
        sources: [],
        visibility: undefined,
      },
      "\n\nBody",
    );
    expect(text).toBe("---\nid: 01AB\ntitle: Lilith\ntags: [x, y]\ncustom: 1\n---\n\nBody\n");
  });

  it("quotes ambiguous strings", () => {
    const text = serializeDocument({ id: "1234567", title: "a: b" }, "");
    const back = parseDocument(text);
    expect(back.data).toEqual({ id: "1234567", title: "a: b" });
  });
});

describe("configuration", () => {
  it("applies default values", () => {
    const { config, problems } = parseConfig(undefined);
    expect(problems).toEqual([]);
    expect(config.root).toBe("wiki");
    expect(config.default_visibility).toBe("private");
    expect(config.mastery.initial).toBe(0.5);
  });

  it("reads and normalizes the configuration", () => {
    const { config } = parseConfig(
      "title: My wiki\nroot: notes/wiki/\nprivate_repo: alice/wiki\nmastery:\n  decay_rate: 0.1\nother: 3\n",
    );
    expect(config.root).toBe("notes/wiki");
    expect(config.private_repo).toBe("alice/wiki");
    expect(config.mastery.decay_rate).toBe(0.1);
    expect(config.mastery.alpha).toBe(0.5);
    expect(config.extra).toEqual({ other: 3 });
    expect(parseConfig(serializeConfig(config)).config).toEqual(config);
  });

  it("reports invalid values", () => {
    const { problems } = parseConfig("default_visibility: friends\nroot: ../x\n");
    expect(problems.length).toBe(2);
  });

  it("the public configuration does not contain personal settings", () => {
    const { config } = parseConfig("title: T\nmastery:\n  alpha: 0.3\nsecret: x\n");
    const text = serializePublicConfig(config, "alice/wiki");
    expect(text).toContain("private_repo: alice/wiki");
    expect(text).not.toContain("mastery");
    expect(text).not.toContain("secret");
  });
});
