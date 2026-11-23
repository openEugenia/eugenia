/**
 * Discussions: all the exchanges with Eugenia in one place (free discussions, questions about
 * the tree, quizzes, quick notes), filterable by kind and by branch of the wiki (common
 * hierarchy), with the page each one is attached to.
 */
import { useMemo, useState } from "react";
import {
  GraduationCap,
  MessageCircleQuestion,
  MessageSquare,
  MessagesSquare,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { discussionsInBranch, DISCUSSION_KINDS, type DiscussionKind } from "@openeugenia/core";
import {
  DiscussionKindIcon,
  DISCUSSION_KIND_LABELS,
  EmptyState,
  TypeIcon,
} from "../components/common.tsx";
import { formatDate, formatPercent, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { normalizeTerm } from "../lib/text.ts";
import type { DiscussionEntry } from "../lib/workspace.ts";

/** Label of a group of dates (today, this week, month). */
function period(value: string | undefined, now: Date): string {
  if (!value) return "No date";
  const date = new Date(value);
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1 && date.getDate() === now.getDate()) return "Today";
  if (days < 7) return "This week";
  return date.toLocaleDateString("en", { month: "long", year: "numeric" });
}

export function DiscussionsView({
  kind,
  q,
  category,
}: {
  kind?: DiscussionKind;
  q?: string;
  /** Only the discussions placed in this branch of the wiki. */
  category?: string;
}) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const [query, setQuery] = useState(q ?? "");
  const branch = category ? derived.tree.nodes.get(category) : undefined;
  const inBranch = useMemo(
    () =>
      branch
        ? new Set(
            discussionsInBranch(derived.tree, derived.hierarchy, branch.id).map((d) => d.path),
          )
        : null,
    [branch, derived.tree, derived.hierarchy],
  );
  const listed = useMemo(
    () => derived.discussions.filter((d) => !inBranch || inBranch.has(d.path)),
    [derived.discussions, inBranch],
  );

  const counts = useMemo(() => {
    const out = new Map<DiscussionKind, number>();
    for (const d of listed) out.set(d.meta.kind, (out.get(d.meta.kind) ?? 0) + 1);
    return out;
  }, [listed]);

  const quizScores = useMemo(() => {
    const out = new Map<string, { sum: number; count: number }>();
    for (const e of derived.quizEvents) {
      if (!e.source) continue;
      const s = out.get(e.source) ?? { sum: 0, count: 0 };
      s.sum += e.score;
      s.count += 1;
      out.set(e.source, s);
    }
    return out;
  }, [derived.quizEvents]);

  const groups = useMemo(() => {
    const words = normalizeTerm(query.trim()).split(/\s+/).filter(Boolean);
    const now = new Date();
    const out: { label: string; entries: DiscussionEntry[] }[] = [];
    for (const entry of listed) {
      if (kind && entry.meta.kind !== kind) continue;
      if (words.length > 0) {
        const related = [entry.meta.about, entry.meta.scope_node]
          .map((id) => (id ? derived.tree.nodes.get(id)?.title : ""))
          .join(" ");
        const haystack = normalizeTerm(
          [entry.meta.title, entry.meta.preview ?? "", related].join(" "),
        );
        if (!words.every((w) => haystack.includes(w))) continue;
      }
      const label = period(entry.meta.created ?? entry.meta.updated, now);
      const last = out[out.length - 1];
      if (last?.label === label) last.entries.push(entry);
      else out.push({ label, entries: [entry] });
    }
    return out;
  }, [listed, derived.tree, kind, query]);

  const setKind = (next: DiscussionKind | undefined): void =>
    navigate(
      {
        name: "discussions",
        ...(next ? { kind: next } : {}),
        ...(query ? { q: query } : {}),
        ...(category ? { category } : {}),
      },
      { replace: true },
    );

  return (
    <div className="page page--wide">
      <header className="section__head">
        <div>
          <h1>Discussions</h1>
          <p className="muted">
            Your exchanges with Eugenia: discussions, questions about the wiki, quizzes and quick
            notes. The knowledge born from them keeps track of its original discussion.
          </p>
        </div>
      </header>

      {editable && (
        <div className="quick-actions section">
          <a className="quick-action oe-card" href={href({ name: "discussion", kind: "note" })}>
            <StickyNote aria-hidden="true" />
            <span>
              <strong>Quick note</strong>
              <span className="muted small">
                An idea, a fact you heard: Eugenia draws knowledge from it and suggests sources.
              </span>
            </span>
          </a>
          <a className="quick-action oe-card" href={href({ name: "ask" })}>
            <MessageCircleQuestion aria-hidden="true" />
            <span>
              <strong>Question</strong>
              <span className="muted small">
                Ask the whole wiki: Eugenia answers citing your pages.
              </span>
            </span>
          </a>
          <a
            className="quick-action oe-card"
            href={href({ name: "quiz", id: derived.tree.rootId })}
          >
            <GraduationCap aria-hidden="true" />
            <span>
              <strong>Quiz</strong>
              <span className="muted small">Review the least mastered flashcards.</span>
            </span>
          </a>
          <a className="quick-action oe-card" href={href({ name: "discussion" })}>
            <MessageSquare aria-hidden="true" />
            <span>
              <strong>Discussion</strong>
              <span className="muted small">
                A free exchange; started from a page, it is attached to it.
              </span>
            </span>
          </a>
        </div>
      )}

      <div className="filters section">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            className="oe-input"
            type="search"
            placeholder="Title, content, related page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the discussions"
          />
        </label>
        {branch && (
          <div className="chips" role="group" aria-label="Branch">
            <a
              className="chip is-active"
              href={href({ name: "discussions", ...(kind ? { kind } : {}) })}
              title="Show the discussions of the whole wiki"
            >
              In {branch.title} <X aria-hidden="true" className="inline-icon" />
            </a>
          </div>
        )}
        <div className="chips" role="group" aria-label="Kind of discussion">
          <button
            type="button"
            className={`chip${kind ? "" : " is-active"}`}
            aria-pressed={!kind}
            onClick={() => setKind(undefined)}
          >
            All <span className="chip__count">{listed.length}</span>
          </button>
          {DISCUSSION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${kind === k ? " is-active" : ""}`}
              aria-pressed={kind === k}
              onClick={() => setKind(kind === k ? undefined : k)}
            >
              <DiscussionKindIcon kind={k} /> {DISCUSSION_KIND_LABELS[k]}{" "}
              <span className="chip__count">{counts.get(k) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {derived.discussions.length === 0 ? (
        <EmptyState icon={<MessagesSquare aria-hidden="true" />} title="No discussions">
          {owner
            ? "Write a quick note, ask a question about your wiki or start a quiz: your exchanges with Eugenia will appear here."
            : "This wiki does not publish any discussion."}
        </EmptyState>
      ) : groups.length === 0 ? (
        <p className="muted">No discussion matches these filters.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="section">
            <h2 className="discussion-group">{group.label}</h2>
            <ul className="discussion-list">
              {group.entries.map((entry) => {
                const target =
                  (entry.meta.about && derived.tree.nodes.get(entry.meta.about)) ||
                  (entry.meta.scope_node && derived.tree.nodes.get(entry.meta.scope_node)) ||
                  undefined;
                const score = quizScores.get(entry.path);
                return (
                  <li key={entry.path}>
                    <a
                      className="discussion-item oe-card"
                      href={href({ name: "discussion", path: entry.path })}
                    >
                      <span className={`discussion-item__icon kind-${entry.meta.kind}`}>
                        <DiscussionKindIcon kind={entry.meta.kind} />
                      </span>
                      <span className="discussion-item__main">
                        <span className="discussion-item__title">
                          {entry.meta.title || "Untitled"}
                        </span>
                        {entry.meta.preview && entry.meta.kind !== "quiz" && (
                          <span className="discussion-item__text">{entry.meta.preview}</span>
                        )}
                        <span className="discussion-item__meta">
                          {DISCUSSION_KIND_LABELS[entry.meta.kind]}
                          {target && (
                            <>
                              {" · "}
                              <TypeIcon node={target} /> {target.title}
                            </>
                          )}
                          {" · "}
                          {entry.meta.kind === "quiz" && score
                            ? `${plural(score.count, "answer")}, average score ${formatPercent(score.sum / score.count)}`
                            : plural(entry.meta.messages, "message")}
                        </span>
                      </span>
                      {entry.meta.created && (
                        <span className="muted small">{formatDate(entry.meta.created)}</span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
