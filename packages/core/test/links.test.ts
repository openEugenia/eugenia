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

describe("analyse des liens", () => {
  it("repère les destinations et leurs positions", () => {
    const text =
      'Voir [**Lilith**](../lilith/index.md "titre") et ![img](a b.png) et <https://x.org>.';
    const { links } = scanLinks(text);
    expect(links.map((l) => [l.kind, l.raw, l.label])).toEqual([
      ["link", "../lilith/index.md", "**Lilith**"],
    ]);
    const first = links[0]!;
    expect(text.slice(first.destStart, first.destEnd)).toBe("../lilith/index.md");
  });

  it("gère les chevrons, les parenthèses et les définitions", () => {
    const text = "[a](<mon dossier/index.md>) [b](x_(1).md)\n\n[ref]: ../c/index.md\n";
    const { links } = scanLinks(text);
    expect(links.map((l) => l.raw)).toEqual(["mon dossier/index.md", "x_(1).md", "../c/index.md"]);
  });

  it("ignore les liens dans le code", () => {
    expect(scanLinks("`[a](b.md)`\n\n```\n[c](d.md)\n```\n").links).toEqual([]);
  });
});

describe("résolution", () => {
  it("résout les liens relatifs et ignore les liens externes", () => {
    expect(resolveLinkTarget("wiki/a/index.md", "../b/index.md#x")).toEqual({
      path: "wiki/b/index.md",
      hash: "#x",
      trailingSlash: false,
    });
    expect(resolveLinkTarget("wiki/a/index.md", "https://example.org")).toBeNull();
    expect(resolveLinkTarget("wiki/a/index.md", "#section")).toBeNull();
    expect(resolveLinkTarget("wiki/index.md", "../../hors.md")).toBeNull();
    expect(resolveLinkTarget("wiki/a/index.md", "mon%20fichier.pdf")?.path).toBe(
      "wiki/a/mon fichier.pdf",
    );
  });

  it("calcule des chemins relatifs", () => {
    expect(relativePath("wiki/a", "wiki/b/index.md")).toBe("../b/index.md");
    expect(relativePath("wiki/a", "wiki/a/c/index.md")).toBe("c/index.md");
    expect(relativePath("wiki/a/b", "wiki/index.md")).toBe("../../index.md");
  });
});

describe("réécriture", () => {
  it("réécrit les liens d'un fichier déplacé et vers une cible déplacée", () => {
    const map = directoryMapper("wiki/a/c", "wiki/b/c");
    // fichier déplacé : ses liens vers l'extérieur sont recalculés
    expect(
      rewriteLinksForMove(
        "[Up](../index.md) [B](../../b/index.md)",
        "wiki/a/c/index.md",
        "wiki/b/c/index.md",
        map,
      ),
    ).toBe("[Up](../../a/index.md) [B](../../b/index.md)"); // lien encore valide : conservé
    // fichier fixe : ses liens vers la branche déplacée sont recalculés
    expect(
      rewriteLinksForMove("[C](../a/c/index.md#x)", "wiki/b/index.md", "wiki/b/index.md", map),
    ).toBe("[C](c/index.md#x)");
    // lien sans rapport : inchangé, même écrit différemment
    expect(
      rewriteLinksForMove("[Z](./z/index.md)", "wiki/b/index.md", "wiki/b/index.md", map),
    ).toBe("[Z](./z/index.md)");
  });

  it("remplace par du texte les liens vers des cibles non publiées", () => {
    const text =
      "[Public](../pub/index.md), [Privé](../priv/index.md) et ![photo](../priv/p.png) [r][x]\n\n[x]: ../priv/index.md\n";
    const out = unlinkTargets(text, "wiki/a/index.md", (t) => t.startsWith("wiki/priv"));
    expect(out).toBe("[Public](../pub/index.md), Privé et photo r\n\n");
  });

  it("extrait le texte brut et les parties en gras", () => {
    expect(markdownToText("# Titre\n\nUn **gras** et un [lien](x.md).\n\n- a\n- b")).toBe(
      "Titre\nUn gras et un lien.\na\nb",
    );
    expect(boldParts("**Lilith** est un démon, **inspirée** d'une divinité")).toEqual([
      "Lilith",
      "inspirée",
    ]);
  });
});
