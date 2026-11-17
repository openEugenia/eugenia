import { describe, expect, it } from "vitest";
import { folderNameFor, humanize, slugify, uniqueName } from "../src/index.ts";

describe("nommage des dossiers", () => {
  it("met en minuscules, retire les accents et remplace la ponctuation", () => {
    expect(slugify("Religion et croyances")).toBe("religion-et-croyances");
    expect(slugify("Économie & finance")).toBe("economie-finance");
    expect(slugify("L'Être et le Néant")).toBe("l-etre-et-le-neant");
    expect(slugify("Œuvres d'art")).toBe("oeuvres-d-art");
    expect(slugify("  --Science!--  ")).toBe("science");
  });

  it("tronque sans couper un mot si possible", () => {
    const title = "Un titre extrêmement long qui dépasse la limite de trente-deux caractères";
    expect(slugify(title)).toBe("un-titre-extremement-long-qui");
    expect(slugify(title).length).toBeLessThanOrEqual(32);
    expect(slugify("Anticonstitutionnellementissimementaire", 32)).toBe(
      "anticonstitutionnellementissimem",
    );
    expect(slugify("Mot exactement découpé ici", 10)).toBe("mot");
  });

  it("utilise un nom de repli pour les titres sans caractère latin", () => {
    expect(slugify("???")).toBe("page");
    expect(slugify("中文")).toBe("page");
  });

  it("ajoute un suffixe en cas de collision", () => {
    expect(uniqueName("lilith", new Set())).toBe("lilith");
    expect(uniqueName("lilith", new Set(["lilith", "lilith-2"]))).toBe("lilith-3");
  });

  it("conserve le nom actuel s'il correspond toujours au titre", () => {
    const taken = new Set(["lilith"]);
    expect(folderNameFor("Lilith", taken, 32, "lilith-3")).toBe("lilith-3");
    expect(folderNameFor("Lilith !", taken, 32, "lilith-2")).toBe("lilith-2");
    expect(folderNameFor("Lune noire", taken, 32, "lilith-2")).toBe("lune-noire");
  });

  it("produit un titre lisible à partir d'un nom de dossier", () => {
    expect(humanize("lune-noire")).toBe("Lune noire");
  });
});
