import { describe, expect, it } from "vitest";
import { folderNameFor, humanize, slugify, uniqueName } from "../src/index.ts";

describe("folder naming", () => {
  it("lowercases, removes accents and replaces punctuation", () => {
    expect(slugify("Religion and beliefs")).toBe("religion-and-beliefs");
    expect(slugify("Economics & finance")).toBe("economics-finance");
    expect(slugify("Being and Nothingness: L'Être et le Néant")).toBe(
      "being-and-nothingness-l-etre-et",
    );
    expect(slugify("Œuvres d'art")).toBe("oeuvres-d-art");
    expect(slugify("  --Science!--  ")).toBe("science");
  });

  it("truncates without cutting a word when possible", () => {
    const title = "An extremely long title that goes beyond the thirty-two character limit";
    expect(slugify(title)).toBe("an-extremely-long-title-that");
    expect(slugify(title).length).toBeLessThanOrEqual(32);
    expect(slugify("Pneumonoultramicroscopicsilicovolcanoconiosis", 32)).toBe(
      "pneumonoultramicroscopicsilicovo",
    );
    expect(slugify("Word exactly cut here", 10)).toBe("word");
  });

  it("uses a fallback name for titles without Latin characters", () => {
    expect(slugify("???")).toBe("page");
    expect(slugify("中文")).toBe("page");
  });

  it("adds a suffix on collision", () => {
    expect(uniqueName("lilith", new Set())).toBe("lilith");
    expect(uniqueName("lilith", new Set(["lilith", "lilith-2"]))).toBe("lilith-3");
  });

  it("keeps the current name if it still matches the title", () => {
    const taken = new Set(["lilith"]);
    expect(folderNameFor("Lilith", taken, 32, "lilith-3")).toBe("lilith-3");
    expect(folderNameFor("Lilith!", taken, 32, "lilith-2")).toBe("lilith-2");
    expect(folderNameFor("Black Moon", taken, 32, "lilith-2")).toBe("black-moon");
  });

  it("produces a readable title from a folder name", () => {
    expect(humanize("black-moon")).toBe("Black moon");
  });
});
