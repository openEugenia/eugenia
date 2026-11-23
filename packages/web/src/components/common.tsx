import type { ReactNode } from "react";
import {
  AlertTriangle,
  Book,
  BookOpen,
  File,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Headphones,
  Layers,
  Library,
  Lightbulb,
  Lock,
  MessageCircleQuestion,
  MessageSquare,
  Newspaper,
  RefreshCw,
  StickyNote,
  Video,
} from "lucide-react";
import type {
  DiscussionKind,
  SourceKind,
  SummaryState,
  Visibility,
  WikiNode,
  WikiTree,
} from "@openeugenia/core";
import { ancestors } from "@openeugenia/core";
import { href } from "../lib/router.ts";

export function Spinner({ small = false, label = "Loading" }: { small?: boolean; label?: string }) {
  return (
    <span className={`spinner${small ? " spinner--sm" : ""}`} role="status" aria-label={label} />
  );
}

export function CenterState({ children }: { children: ReactNode }) {
  return <div className="center-state">{children}</div>;
}

export function Loading({ message }: { message?: string | null }) {
  return (
    <CenterState>
      <Spinner />
      <p className="muted">{message ?? "Loading…"}</p>
    </CenterState>
  );
}

export function ErrorBox({ title = "Error", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="oe-alert oe-alert--danger" role="alert">
      <strong className="oe-alert__title">{title}</strong>
      {children}
    </div>
  );
}

export function InfoBox({
  title,
  children,
  kind = "info",
}: {
  title?: string;
  children: ReactNode;
  kind?: "info" | "warning" | "success";
}) {
  return (
    <div className={`oe-alert oe-alert--${kind}`}>
      {title && <strong className="oe-alert__title">{title}</strong>}
      {children}
    </div>
  );
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  book: "Book",
  article: "Article",
  web: "Website",
  video: "Video",
  audio: "Audio",
  document: "Document",
  other: "Other",
};

export function SourceKindIcon({ kind }: { kind: SourceKind | undefined }) {
  switch (kind) {
    case "book":
      return <Book aria-hidden="true" />;
    case "article":
      return <Newspaper aria-hidden="true" />;
    case "web":
      return <Globe aria-hidden="true" />;
    case "video":
      return <Video aria-hidden="true" />;
    case "audio":
      return <Headphones aria-hidden="true" />;
    case "document":
      return <FileText aria-hidden="true" />;
    default:
      return <File aria-hidden="true" />;
  }
}

/** Icon of the node type (decorative: the title always comes with it). */
export function TypeIcon({ node }: { node: WikiNode; tree?: WikiTree }) {
  switch (node.type) {
    case "knowledge":
      return <Lightbulb aria-hidden="true" />;
    case "flashcard":
      return <Layers aria-hidden="true" />;
    case "source":
      return <SourceKindIcon kind={node.sourceKind} />;
    default:
      return node.space === "library" ? (
        <Library aria-hidden="true" />
      ) : (
        <Folder aria-hidden="true" />
      );
  }
}

export function typeLabel(node: WikiNode): string {
  switch (node.type) {
    case "knowledge":
      return "Atomic knowledge";
    case "flashcard":
      return "Flashcard";
    case "source":
      return node.sourceKind ? `Source · ${SOURCE_KIND_LABELS[node.sourceKind]}` : "Source";
    default:
      return node.space === "library" ? "Library" : "Category";
  }
}

export { DISCUSSION_KIND_LABELS } from "@openeugenia/core";

export function DiscussionKindIcon({ kind }: { kind: DiscussionKind }) {
  switch (kind) {
    case "question":
      return <MessageCircleQuestion aria-hidden="true" />;
    case "quiz":
      return <GraduationCap aria-hidden="true" />;
    case "note":
      return <StickyNote aria-hidden="true" />;
    default:
      return <MessageSquare aria-hidden="true" />;
  }
}

/** Knowledge without a source: to be backed by a library source. */
export function UnsourcedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "unsourced unsourced--compact" : "oe-badge oe-badge--warning unsourced"}
      title="No source backs this knowledge item"
    >
      <AlertTriangle aria-hidden="true" />
      <span className={compact ? "sr-only" : ""}>Needs a source</span>
    </span>
  );
}

export function VisibilityBadge({
  visibility,
  compact = false,
}: {
  visibility: Visibility;
  compact?: boolean;
}) {
  const isPublic = visibility === "public";
  return (
    <span
      className={`visibility ${compact ? "" : `oe-badge ${isPublic ? "oe-badge--success" : ""}`}`}
      title={isPublic ? "Public: visible to everyone" : "Private: visible to you only"}
    >
      {isPublic ? <Globe aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span className={compact ? "sr-only" : ""}>{isPublic ? "Public" : "Private"}</span>
    </span>
  );
}

export function SummaryStatusBadge({ state }: { state: SummaryState | undefined }) {
  if (!state) return null;
  switch (state.status) {
    case "stale":
      return (
        <span
          className="oe-badge oe-badge--info"
          title="The content changed since this description was generated"
        >
          <RefreshCw aria-hidden="true" /> Stale description
        </span>
      );
    case "missing":
      return <span className="oe-badge oe-badge--warning">Missing description</span>;
    case "locked":
      return (
        <span className="oe-badge">
          <Lock aria-hidden="true" /> Locked
        </span>
      );
    default:
      return null;
  }
}

/** Link to a page; the library root opens the list of sources. */
export function nodeHref(tree: WikiTree, node: Pick<WikiNode, "id">): string {
  return node.id === tree.libraryId
    ? href({ name: "library" })
    : href({ name: "node", id: node.id });
}

export function Breadcrumb({
  tree,
  node,
  trail,
}: {
  tree: WikiTree;
  node?: WikiNode;
  /** Extra steps, first (e.g. "Discussions"). */
  trail?: { label: string; href: string }[];
}) {
  const chain = node ? ancestors(tree, node.id) : [];
  const steps = [
    ...(trail ?? []),
    ...chain.map((a) => ({ label: a.title, href: nodeHref(tree, a) })),
  ];
  if (steps.length === 0) return null;
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {steps.map((step, i) => (
        <span key={`${step.href}-${i}`}>
          <a href={step.href}>{step.label}</a>
          {i < steps.length - 1 && <span aria-hidden="true"> › </span>}
        </span>
      ))}
    </nav>
  );
}

export function nodePath(tree: WikiTree, node: WikiNode): string {
  return [...ancestors(tree, node.id).map((a) => a.title), node.title].join(" › ");
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="oe-card" style={{ alignItems: "flex-start" }}>
      <strong
        className="oe-card__title"
        style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
      >
        {icon ?? <BookOpen aria-hidden="true" />} {title}
      </strong>
      {children && <div className="oe-card__body">{children}</div>}
    </div>
  );
}

/**
 * Private source shown in the public part of a wiki: only its bibliographic record (title,
 * kind, authors, date, URL) is published, so that public knowledge can still cite it.
 */
export function RecordBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "visibility" : "oe-badge"}
      title="Private source: only its bibliographic record is published"
    >
      <Lock aria-hidden="true" />
      <span className={compact ? "sr-only" : ""}>Record only</span>
    </span>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <span
      className="muted small"
      style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}
    >
      <AlertTriangle aria-hidden="true" style={{ color: "var(--oe-color-warning)" }} />
      {children}
    </span>
  );
}

export { MessageSquare };
