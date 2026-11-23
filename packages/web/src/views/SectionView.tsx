/**
 * Section of the index of a source (§8.6), browsed like a category of the wiki: where it is (the
 * wiki, the source, the enclosing sections), what it says, the knowledge it proposes, its
 * subsections, and the sections before and after it.
 */
import { ChevronLeft, ChevronRight, ListTree, MessageSquare } from "lucide-react";
import { indexAncestry, indexKnowledge } from "@openeugenia/core";
import { Breadcrumb, ErrorBox, Loading, VisibilityBadge } from "../components/common.tsx";
import {
  IndexCards,
  IndexingProgress,
  ProposedKnowledge,
  sectionHref,
} from "../components/SourcePanels.tsx";
import { plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { useSourceIndex } from "../lib/indexing.ts";
import { href } from "../lib/router.ts";

export function SectionView({ sourceId, sectionKey }: { sourceId: string; sectionKey: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const source = derived.tree.nodes.get(sourceId);
  const { index, loading, error } = useSourceIndex(source);

  if (!source || source.type !== "source") {
    return (
      <div className="page">
        <ErrorBox title="Source not found">This source does not exist, or no longer does.</ErrorBox>
      </div>
    );
  }
  if (loading && !index) return <Loading message="Loading the index…" />;
  const chain = index ? indexAncestry(index.root, sectionKey) : [];
  const node = chain.at(-1);
  if (!index || !node || chain.length < 2) {
    return (
      <div className="page">
        <Breadcrumb tree={derived.tree} node={source} />
        <ErrorBox title="Section not found">
          {error ??
            "This part of the index does not exist, or no longer does: the source may have been indexed again."}{" "}
          <a href={href({ name: "node", id: source.id })}>Back to "{source.title}"</a>
        </ErrorBox>
      </div>
    );
  }
  const parent = chain.at(-2)!;
  const position = parent.children.findIndex((c) => c.key === node.key);
  const previous = parent.children[position - 1];
  const next = parent.children[position + 1];
  const knowledge = indexKnowledge(node).length;

  return (
    <article className="page">
      <Breadcrumb
        tree={derived.tree}
        node={source}
        tail={[
          { label: source.title, href: href({ name: "node", id: source.id }) },
          ...chain
            .slice(1, -1)
            .map((n) => ({ label: n.name, href: sectionHref(source.id, n.key) })),
        ]}
      />
      <header className="node-head">
        <div className="node-head__title">
          <h1>{node.name}</h1>
          <div className="node-head__meta">
            <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
              <ListTree aria-hidden="true" /> Part of the index of{" "}
              <a href={href({ name: "node", id: source.id })}>{source.title}</a>
            </span>
            {owner && <VisibilityBadge visibility={source.isPublic ? "public" : "private"} />}
            {node.children.length > 0 && <span>{plural(node.children.length, "part")}</span>}
            {knowledge > 0 && <span>{plural(knowledge, "knowledge item")} to extract</span>}
          </div>
        </div>
      </header>

      <div className="toolbar" style={{ marginTop: "1rem" }}>
        {editable && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "discussion", about: source.id })}
          >
            <MessageSquare aria-hidden="true" /> Discuss the source
          </a>
        )}
        <IndexingProgress sourceId={source.id} />
      </div>

      {node.description && <p className="index-summary section">{node.description}</p>}

      {node.children.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Parts</h2>
            <span className="muted small">{plural(node.children.length, "part")}</span>
          </div>
          <IndexCards source={source} nodes={node.children} />
        </section>
      )}

      <ProposedKnowledge source={source} node={node} />

      {(previous || next) && (
        <nav className="section-nav section" aria-label="Neighbouring parts">
          {previous ? (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={sectionHref(source.id, previous.key)}
            >
              <ChevronLeft aria-hidden="true" /> {previous.name}
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={sectionHref(source.id, next.key)}
            >
              {next.name} <ChevronRight aria-hidden="true" />
            </a>
          )}
        </nav>
      )}
    </article>
  );
}
