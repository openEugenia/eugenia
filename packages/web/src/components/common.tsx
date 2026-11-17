import type { ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  Folder,
  Globe,
  Lock,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { SummaryState, Visibility, WikiNode, WikiTree } from "@openeugenia/core";
import { ancestors } from "@openeugenia/core";
import { href } from "../lib/router.ts";

export function Spinner({
  small = false,
  label = "Chargement",
}: {
  small?: boolean;
  label?: string;
}) {
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
      <p className="muted">{message ?? "Chargement…"}</p>
    </CenterState>
  );
}

export function ErrorBox({ title = "Erreur", children }: { title?: string; children: ReactNode }) {
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

/** Icône du type de nœud (décorative : le titre l'accompagne toujours). */
export function TypeIcon({ node, tree }: { node: WikiNode; tree?: WikiTree }) {
  if (node.type === "flashcard") return <Sparkles aria-hidden="true" />;
  if (node.childIds.length > 0 || node.virtual || (tree && node.id === tree.rootId))
    return <Folder aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

export function typeLabel(node: WikiNode): string {
  if (node.type === "flashcard") return "Connaissance atomique";
  return node.childIds.length > 0 ? "Catégorie" : "Note";
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
      title={isPublic ? "Public : visible par tous" : "Privé : visible par vous seul"}
    >
      {isPublic ? <Globe aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span className={compact ? "sr-only" : ""}>{isPublic ? "Public" : "Privé"}</span>
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
          title="Le contenu a changé depuis la génération de cette description"
        >
          <RefreshCw aria-hidden="true" /> Description périmée
        </span>
      );
    case "missing":
      return <span className="oe-badge oe-badge--warning">Description manquante</span>;
    case "locked":
      return (
        <span className="oe-badge">
          <Lock aria-hidden="true" /> Verrouillée
        </span>
      );
    default:
      return null;
  }
}

export function Breadcrumb({ tree, node }: { tree: WikiTree; node: WikiNode }) {
  const chain = ancestors(tree, node.id);
  if (chain.length === 0) return null;
  return (
    <nav className="breadcrumb" aria-label="Fil d'Ariane">
      {chain.map((a, i) => (
        <span key={a.id}>
          <a href={href({ name: "node", id: a.id })}>{a.title}</a>
          {i < chain.length - 1 && <span aria-hidden="true"> › </span>}
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
