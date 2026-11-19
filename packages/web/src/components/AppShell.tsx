/**
 * Coquille de l'application : barre supérieure, panneau latéral à trois espaces (wiki,
 * bibliothèque, discussions), contenu.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CloudOff,
  FolderTree,
  Globe,
  LayoutDashboard,
  Library,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
} from "lucide-react";
import { librarySources } from "@openeugenia/core";
import { formatDate } from "../lib/format.ts";
import { uncommittedPaths } from "../lib/pending.ts";
import { href, navigate, openRepo, useRoute, type Route } from "../lib/router.ts";
import { normalizeTerm } from "../lib/text.ts";
import type { Derived } from "../lib/workspace.ts";
import { canEdit, useWiki } from "../store/wiki.ts";
import { DiscussionKindIcon, SourceKindIcon, Spinner, VisibilityBadge } from "./common.tsx";
import { moveWithConfirmation } from "./NodeActions.tsx";
import { TreeView } from "./TreeView.tsx";

function SyncIndicator() {
  const pending = useWiki((s) => s.pending);
  const online = useWiki((s) => s.online);
  const offline = useWiki((s) => s.offline);
  const syncing = useWiki((s) => s.syncing);
  const count = Object.keys(pending.changes).length;
  const uncommitted = uncommittedPaths(pending).length;
  let className = "sync-indicator";
  let label = "À jour";
  if (pending.conflicts.length > 0) {
    className += " is-conflict";
    label = `${pending.conflicts.length} conflit(s)`;
  } else if (!online || offline) {
    className += " is-offline";
    label = count > 0 ? `Hors ligne · ${count} en attente` : "Hors ligne";
  } else if (syncing) {
    label = "Synchronisation…";
  } else if (count > 0) {
    className += " is-pending";
    label =
      uncommitted > 0
        ? `${uncommitted} modification(s) à enregistrer`
        : `${count} en file d'attente`;
  }
  return (
    <a
      className={`oe-button oe-button--ghost oe-button--sm ${className}`}
      href={href({ name: "changes" })}
      title="Modifications et synchronisation"
    >
      {syncing ? (
        <Spinner small label="Synchronisation" />
      ) : !online || offline ? (
        <CloudOff aria-hidden="true" />
      ) : (
        <span className="dot" aria-hidden="true" />
      )}
      <span className="app-bar__label">{label}</span>
    </a>
  );
}

export type Section = "wiki" | "library" | "discussions";

/** Espace correspondant à la page ouverte. */
function sectionFor(route: Route, derived: Derived, currentId: string | undefined): Section {
  if (route.name === "library") return "library";
  if (route.name === "discussions" || route.name === "discussion" || route.name === "ask")
    return "discussions";
  if (route.name === "extract" && route.discussion) return "discussions";
  const node = currentId ? derived.tree.nodes.get(currentId) : undefined;
  if (node?.space === "library") return "library";
  return "wiki";
}

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "wiki", label: "Wiki", icon: <FolderTree aria-hidden="true" /> },
  { id: "library", label: "Bibliothèque", icon: <Library aria-hidden="true" /> },
  { id: "discussions", label: "Discussions", icon: <MessagesSquare aria-hidden="true" /> },
];

/** Bibliothèque dans le panneau latéral : sources par titre, filtre rapide. */
function LibraryPanel({
  derived,
  currentId,
  owner,
  onNavigate,
}: {
  derived: Derived;
  currentId: string | undefined;
  owner: boolean;
  onNavigate(): void;
}) {
  const [filter, setFilter] = useState("");
  const sources = useMemo(
    () => librarySources(derived.tree).sort((a, b) => a.title.localeCompare(b.title, "fr")),
    [derived.tree],
  );
  const q = normalizeTerm(filter.trim());
  const visible = q
    ? sources.filter((s) => normalizeTerm(`${s.title} ${s.authors.join(" ")}`).includes(q))
    : sources;
  return (
    <div className="side-panel">
      {sources.length > 8 && (
        <input
          className="oe-input oe-input--sm"
          type="search"
          placeholder="Filtrer les sources…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrer les sources"
        />
      )}
      {sources.length === 0 ? (
        <p className="muted small side-panel__empty">
          Aucune source. Ajoutez les livres, articles et sites d'où viennent vos connaissances.
        </p>
      ) : (
        <ul className="tree">
          {visible.map((s) => (
            <li key={s.id}>
              <div className={`tree-row${s.id === currentId ? " is-current" : ""}`}>
                <span className="tree-spacer" />
                <a
                  href={href({ name: "node", id: s.id })}
                  aria-current={s.id === currentId ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <SourceKindIcon kind={s.sourceKind} />
                  <span className="title">{s.title}</span>
                </a>
                <span className="tree-flags">
                  <span className="muted small" title="Connaissances qui citent cette source">
                    {derived.knowledgeBySource.get(s.id)?.length ?? 0}
                  </span>
                  {owner && (
                    <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <a className="side-panel__more" href={href({ name: "library" })} onClick={onNavigate}>
        Toute la bibliothèque
      </a>
    </div>
  );
}

/** Discussions récentes dans le panneau latéral. */
function DiscussionsPanel({
  derived,
  currentPath,
  onNavigate,
}: {
  derived: Derived;
  currentPath: string | undefined;
  onNavigate(): void;
}) {
  const recent = derived.discussions.slice(0, 40);
  return (
    <div className="side-panel">
      {recent.length === 0 ? (
        <p className="muted small side-panel__empty">
          Aucune discussion. Écrivez une note rapide ou posez une question sur votre wiki.
        </p>
      ) : (
        <ul className="tree">
          {recent.map((d) => (
            <li key={d.path}>
              <div className={`tree-row${d.path === currentPath ? " is-current" : ""}`}>
                <span className="tree-spacer" />
                <a
                  href={href({ name: "discussion", path: d.path })}
                  aria-current={d.path === currentPath ? "page" : undefined}
                  onClick={onNavigate}
                  title={d.meta.preview ?? d.meta.title}
                >
                  <DiscussionKindIcon kind={d.meta.kind} />
                  <span className="title">{d.meta.title || "Sans titre"}</span>
                </a>
                <span className="tree-flags muted small">
                  {d.meta.created ? formatDate(d.meta.created) : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <a className="side-panel__more" href={href({ name: "discussions" })} onClick={onNavigate}>
        Toutes les discussions
      </a>
    </div>
  );
}

export function AppShell({ children, currentId }: { children: ReactNode; currentId?: string }) {
  const derived = useWiki((s) => s.derived);
  const workspace = useWiki((s) => s.workspace);
  const resolved = useWiki((s) => s.resolved);
  const editable = useWiki((s) => canEdit(s));
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState(route.name === "search" ? (route.q ?? "") : "");
  const routeSection = derived ? sectionFor(route, derived, currentId) : "wiki";
  const [section, setSection] = useState<Section>(routeSection);
  // L'onglet suit la page ouverte ; l'utilisateur peut en changer librement ensuite.
  useEffect(() => setSection(routeSection), [routeSection]);
  if (!derived || !workspace) return null;
  const owner = workspace.mode === "owner";
  const staleCount = owner
    ? [...derived.summaryStates.private.values(), ...derived.summaryStates.public.values()].filter(
        (s) => s.status === "stale" || s.status === "missing",
      ).length
    : 0;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    navigate({ name: "search", ...(query.trim() ? { q: query.trim() } : {}) });
  };

  return (
    <div className={`shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <header className="app-bar">
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm icon-only menu-toggle"
          aria-label="Afficher l'arbre"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <Menu />
        </button>
        <a
          className="app-brand"
          href="./"
          onClick={(e) => {
            e.preventDefault();
            openRepo(null);
          }}
          title="Accueil d'Eugenia"
        >
          <img src={`${import.meta.env.BASE_URL}icons/mark.svg`} alt="" />
          <span className="app-brand__name">Eugenia</span>
        </a>
        <a className="app-bar__wiki" href={href({ name: "root" })} title={derived.config.title}>
          {derived.config.title}
        </a>
        {!owner && (
          <span
            className="oe-badge oe-badge--success"
            title="Vous consultez la partie publique de ce wiki"
          >
            <Globe aria-hidden="true" /> <span className="app-bar__label">Public</span>
          </span>
        )}
        {owner && !resolved?.canWrite && (
          <span className="oe-badge oe-badge--warning" title={resolved?.readOnlyReason}>
            <AlertTriangle aria-hidden="true" />{" "}
            <span className="app-bar__label">Lecture seule</span>
          </span>
        )}
        <form className="app-bar__search" role="search" onSubmit={submit}>
          <input
            className="oe-input"
            type="search"
            placeholder="Rechercher…"
            aria-label="Rechercher dans le wiki"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <nav className="app-bar__actions" aria-label="Outils">
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "search" })}
            aria-label="Recherche"
            title="Recherche"
          >
            <Search />
          </a>
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "ask" })}
            title="Poser une question sur le wiki"
          >
            <MessageCircleQuestion aria-hidden="true" />{" "}
            <span className="app-bar__label">Questions</span>
          </a>
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "graph" })}
            aria-label="Graphe"
            title="Graphe"
          >
            <Network />
          </a>
          {owner && (
            <a
              className="oe-button oe-button--ghost oe-button--sm icon-only"
              href={href({ name: "dashboard" })}
              aria-label="Tableau de bord"
              title="Tableau de bord"
            >
              <LayoutDashboard />
            </a>
          )}
          {owner && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "summaries" })}
              title="Descriptions des sous-wikis"
            >
              <RefreshCw aria-hidden="true" />
              {staleCount > 0 && (
                <span
                  className="count-badge"
                  aria-label={`${staleCount} descriptions périmées ou manquantes`}
                >
                  {staleCount}
                </span>
              )}
            </a>
          )}
          {owner && <SyncIndicator />}
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "settings" })}
            aria-label="Paramètres"
            title="Paramètres"
          >
            <Settings />
          </a>
        </nav>
      </header>
      <aside className="sidebar" aria-label="Espaces du wiki">
        <div className="section-tabs" role="tablist" aria-label="Espaces">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              className={`section-tab${section === item.id ? " is-active" : ""}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar__head">
          <a
            className="oe-eyebrow sidebar__title"
            href={
              section === "wiki"
                ? href({ name: "root" })
                : section === "library"
                  ? href({ name: "library" })
                  : href({ name: "discussions" })
            }
            onClick={() => setSidebarOpen(false)}
          >
            {section === "wiki" ? "Connaissances" : section === "library" ? "Sources" : "Récentes"}
          </a>
          {editable && section === "wiki" && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({
                name: "new",
                parentId:
                  currentId && derived.tree.nodes.get(currentId)?.type === "category"
                    ? currentId
                    : derived.tree.rootId,
                type: "category",
              })}
              title="Nouvelle catégorie"
            >
              <Plus aria-hidden="true" /> Catégorie
            </a>
          )}
          {editable && section === "library" && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: derived.tree.libraryId, type: "source" })}
              title="Nouvelle source"
            >
              <Plus aria-hidden="true" /> Source
            </a>
          )}
          {editable && section === "discussions" && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "discussion", kind: "note" })}
              title="Nouvelle note rapide"
            >
              <StickyNote aria-hidden="true" /> Note
            </a>
          )}
        </div>
        {section === "wiki" && (
          <TreeView
            derived={derived}
            currentId={currentId}
            owner={owner}
            canEdit={editable}
            storageKey={workspace.key}
            onMove={(id, parent) => void moveWithConfirmation(id, parent)}
            onNavigate={() => setSidebarOpen(false)}
          />
        )}
        {section === "library" && (
          <LibraryPanel
            derived={derived}
            currentId={currentId}
            owner={owner}
            onNavigate={() => setSidebarOpen(false)}
          />
        )}
        {section === "discussions" && (
          <DiscussionsPanel
            derived={derived}
            currentPath={route.name === "discussion" ? route.path : undefined}
            onNavigate={() => setSidebarOpen(false)}
          />
        )}
      </aside>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
