import { describe, expect, it } from "vitest";
import {
  newDiscussionPath,
  discussionMeta,
  discussionNodes,
  parseDiscussion,
  quizEvents,
  serializeDiscussion,
} from "../src/index.ts";

const QUIZ = `---
id: 01JD3Q
type: discussion
kind: quiz
title: Quiz — Religion et croyances
scope_node: 01JD3K8Z9X
visibility: private
---

## eugenia · 2026-11-17T10:30:00Z
<!-- eugenia: {"card": "01JD3R", "role": "question"} -->
Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité mésopotamienne ?

## user · 2026-11-17T10:30:20Z
Je pense que c'est Lilite la Pépite

## eugenia · 2026-11-17T10:30:24Z
<!-- eugenia: {"card": "01JD3R", "role": "feedback", "score": 0.3} -->
La réponse est incorrecte : Lilith était attendue.
`;

describe("discussions et quiz", () => {
  it("lit l'exemple de la spécification", () => {
    const doc = parseDiscussion(QUIZ);
    expect(doc.fields).toMatchObject({
      id: "01JD3Q",
      kind: "quiz",
      scope_node: "01JD3K8Z9X",
      visibility: "private",
    });
    expect(doc.messages.map((m) => m.role)).toEqual(["eugenia", "user", "eugenia"]);
    expect(doc.messages[0]!.meta).toEqual({ card: "01JD3R", role: "question" });
    expect(doc.messages[1]!.content).toBe("Je pense que c'est Lilite la Pépite");
    expect(quizEvents(doc, "x.md")).toEqual([
      { card: "01JD3R", score: 0.3, at: "2026-11-17T10:30:24Z", source: "x.md" },
    ]);
  });

  it("réécrit un fichier identique après lecture", () => {
    expect(serializeDiscussion(parseDiscussion(QUIZ))).toBe(QUIZ);
  });

  it("protège les lignes qui ressemblent à un en-tête de message", () => {
    const doc = parseDiscussion(QUIZ);
    doc.messages[1]!.content = "## user · 2026-01-01T00:00:00Z\nsuite";
    const back = parseDiscussion(serializeDiscussion(doc));
    expect(back.messages.length).toBe(3);
    expect(back.messages[1]!.content).toBe("## user · 2026-01-01T00:00:00Z\nsuite");
  });

  it("nomme les fichiers de discussion dans le dossier des discussions", () => {
    const date = new Date("2026-11-17T10:30:00Z");
    const config = { discussions: "discussions" };
    expect(newDiscussionPath(config, "Lilith et la Lune noire", new Set(), date)).toBe(
      "discussions/2026-11-17-1030-lilith-et-la-lune-noire.md",
    );
    expect(newDiscussionPath(config, "Quiz", new Set(["2026-11-17-1030-quiz.md"]), date)).toBe(
      "discussions/2026-11-17-1030-quiz-2.md",
    );
  });

  it("lit la sorte et l'aperçu d'une discussion", () => {
    const meta = discussionMeta(QUIZ);
    expect(meta.kind).toBe("quiz");
    expect(meta.messages).toBe(3);
    expect(meta.preview).toBe("Je pense que c'est Lilite la Pépite");
    const note = discussionMeta(
      "---\nid: N\ntype: discussion\nkind: note\ntitle: Idée\nabout: K\n---\n\n## user · 2026-01-01T00:00:00Z\nUne **idée**.\n",
    );
    expect(note).toMatchObject({
      id: "N",
      kind: "note",
      title: "Idée",
      about: "K",
      preview: "Une idée.",
    });
    expect(discussionNodes(note)).toEqual(["K"]);
    expect(discussionMeta("---\nid: D\n---\n").kind).toBe("discussion");
  });

  it("ne compte les évaluations que dans les quiz", () => {
    const doc = parseDiscussion(QUIZ);
    delete doc.fields.kind;
    expect(quizEvents(doc)).toEqual([]);
  });
});
