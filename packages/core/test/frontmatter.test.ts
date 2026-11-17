import { describe, expect, it } from "vitest";
import {
  parseDocument,
  serializeDocument,
  parseConfig,
  serializeConfig,
  serializePublicConfig,
} from "../src/index.ts";

describe("frontmatter", () => {
  it("lit le frontmatter et le corps", () => {
    const doc = parseDocument("---\nid: 01AB\ntitle: Lilith\ntags: [a, b]\n---\n\nTexte\n");
    expect(doc.hasFrontmatter).toBe(true);
    expect(doc.data).toEqual({ id: "01AB", title: "Lilith", tags: ["a", "b"] });
    expect(doc.body).toBe("Texte\n");
  });

  it("garde les dates ISO sous forme de chaînes", () => {
    const doc = parseDocument("---\ncreated: 2026-11-17T10:30:00Z\n---\n");
    expect(doc.data.created).toBe("2026-11-17T10:30:00Z");
  });

  it("accepte un frontmatter vide et un BOM", () => {
    expect(parseDocument("﻿---\n---\nCorps").body).toBe("Corps");
  });

  it("signale un YAML invalide sans lever d'exception", () => {
    const doc = parseDocument("---\ntitle: [non fermé\n---\nCorps");
    expect(doc.error).toMatch(/YAML invalide/);
    expect(doc.body).toBe("Corps");
  });

  it("sans frontmatter, tout est corps", () => {
    const doc = parseDocument("# Titre\n");
    expect(doc.hasFrontmatter).toBe(false);
    expect(doc.body).toBe("# Titre\n");
  });

  it("écrit les clés dans l'ordre et omet les valeurs vides", () => {
    const text = serializeDocument(
      {
        custom: 1,
        title: "Lilith",
        id: "01AB",
        tags: ["x", "y"],
        sources: [],
        visibility: undefined,
      },
      "\n\nCorps",
    );
    expect(text).toBe("---\nid: 01AB\ntitle: Lilith\ntags: [x, y]\ncustom: 1\n---\n\nCorps\n");
  });

  it("met entre guillemets les chaînes ambiguës", () => {
    const text = serializeDocument({ id: "1234567", title: "a: b" }, "");
    const back = parseDocument(text);
    expect(back.data).toEqual({ id: "1234567", title: "a: b" });
  });
});

describe("configuration", () => {
  it("applique les valeurs par défaut", () => {
    const { config, problems } = parseConfig(undefined);
    expect(problems).toEqual([]);
    expect(config.root).toBe("wiki");
    expect(config.default_visibility).toBe("private");
    expect(config.mastery.initial).toBe(0.5);
  });

  it("lit et normalise la configuration", () => {
    const { config } = parseConfig(
      "title: Mon wiki\nroot: notes/wiki/\nprivate_repo: alice/wiki\nmastery:\n  decay_rate: 0.1\nautre: 3\n",
    );
    expect(config.root).toBe("notes/wiki");
    expect(config.private_repo).toBe("alice/wiki");
    expect(config.mastery.decay_rate).toBe(0.1);
    expect(config.mastery.alpha).toBe(0.5);
    expect(config.extra).toEqual({ autre: 3 });
    expect(parseConfig(serializeConfig(config)).config).toEqual(config);
  });

  it("signale les valeurs invalides", () => {
    const { problems } = parseConfig("default_visibility: friends\nroot: ../x\n");
    expect(problems.length).toBe(2);
  });

  it("la configuration publique ne contient pas les paramètres personnels", () => {
    const { config } = parseConfig("title: T\nmastery:\n  alpha: 0.3\nsecret: x\n");
    const text = serializePublicConfig(config, "alice/wiki");
    expect(text).toContain("private_repo: alice/wiki");
    expect(text).not.toContain("mastery");
    expect(text).not.toContain("secret");
  });
});
