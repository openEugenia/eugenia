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
title: Quiz — Religion and beliefs
scope_node: 01JD3K8Z9X
visibility: private
---

## eugenia · 2026-11-17T10:30:00Z
<!-- eugenia: {"card": "01JD3R", "role": "question"} -->
What is the name of the female demon of Jewish tradition, inspired by a Mesopotamian deity?

## user · 2026-11-17T10:30:20Z
I think it is Lilita the Pita

## eugenia · 2026-11-17T10:30:24Z
<!-- eugenia: {"card": "01JD3R", "role": "feedback", "score": 0.3} -->
The answer is incorrect: Lilith was expected.
`;

describe("discussions and quizzes", () => {
  it("reads the example of the specification", () => {
    const doc = parseDiscussion(QUIZ);
    expect(doc.fields).toMatchObject({
      id: "01JD3Q",
      kind: "quiz",
      scope_node: "01JD3K8Z9X",
      visibility: "private",
    });
    expect(doc.messages.map((m) => m.role)).toEqual(["eugenia", "user", "eugenia"]);
    expect(doc.messages[0]!.meta).toEqual({ card: "01JD3R", role: "question" });
    expect(doc.messages[1]!.content).toBe("I think it is Lilita the Pita");
    expect(quizEvents(doc, "x.md")).toEqual([
      { card: "01JD3R", score: 0.3, at: "2026-11-17T10:30:24Z", source: "x.md" },
    ]);
  });

  it("writes back an identical file after reading", () => {
    expect(serializeDiscussion(parseDiscussion(QUIZ))).toBe(QUIZ);
  });

  it("protects lines that look like a message header", () => {
    const doc = parseDiscussion(QUIZ);
    doc.messages[1]!.content = "## user · 2026-01-01T00:00:00Z\nmore";
    const back = parseDiscussion(serializeDiscussion(doc));
    expect(back.messages.length).toBe(3);
    expect(back.messages[1]!.content).toBe("## user · 2026-01-01T00:00:00Z\nmore");
  });

  it("names discussion files in the discussions folder", () => {
    const date = new Date("2026-11-17T10:30:00Z");
    const config = { discussions: "discussions" };
    expect(newDiscussionPath(config, "Lilith and the Black Moon", new Set(), date)).toBe(
      "discussions/2026-11-17-1030-lilith-and-the-black-moon.md",
    );
    expect(newDiscussionPath(config, "Quiz", new Set(["2026-11-17-1030-quiz.md"]), date)).toBe(
      "discussions/2026-11-17-1030-quiz-2.md",
    );
  });

  it("reads the kind and preview of a discussion", () => {
    const meta = discussionMeta(QUIZ);
    expect(meta.kind).toBe("quiz");
    expect(meta.messages).toBe(3);
    expect(meta.preview).toBe("I think it is Lilita the Pita");
    const note = discussionMeta(
      "---\nid: N\ntype: discussion\nkind: note\ntitle: Idea\nabout: K\n---\n\n## user · 2026-01-01T00:00:00Z\nAn **idea**.\n",
    );
    expect(note).toMatchObject({
      id: "N",
      kind: "note",
      title: "Idea",
      about: "K",
      preview: "An idea.",
    });
    expect(discussionNodes(note)).toEqual(["K"]);
    expect(discussionMeta("---\nid: D\n---\n").kind).toBe("discussion");
  });

  it("only counts evaluations in quizzes", () => {
    const doc = parseDiscussion(QUIZ);
    delete doc.fields.kind;
    expect(quizEvents(doc)).toEqual([]);
  });
});
