/** Coquille de l'application : barre supérieure, arbre latéral, contenu. */
import { useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CloudOff,
  Globe,
  LayoutDashboard,
  Menu,
  MessageCircleQuestion,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { uncommittedPaths } from "../lib/pending.ts";
import { href, navigate, openRepo, useRoute } from "../lib/router.ts";
import { canEdit, useWiki } from "../store/wiki.ts";
import { Spinner } from "./common.tsx";
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

export function AppShell({ children, currentId }: { children: ReactNode; currentId?: string }) {
  const derived = useWiki((s) => s.derived);
  const workspace = useWiki((s) => s.workspace);
  const resolved = useWiki((s) => s.resolved);
  const editable = useWiki((s) => canEdit(s));
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState(route.name === "search" ? (route.q ?? "") : "");
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
      <aside className="sidebar" aria-label="Arbre du wiki">
        <div className="sidebar__head">
          <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
            Wiki
          </span>
          {editable && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({
                name: "new",
                parentId:
                  currentId && derived.tree.nodes.get(currentId)?.type !== "flashcard"
                    ? currentId
                    : derived.tree.rootId,
                type: "note",
              })}
              title="Nouvelle page"
            >
              <Plus aria-hidden="true" /> Page
            </a>
          )}
        </div>
        <TreeView
          derived={derived}
          currentId={currentId}
          owner={owner}
          canEdit={editable}
          storageKey={workspace.key}
          onMove={(id, parent) => void moveWithConfirmation(id, parent)}
          onNavigate={() => setSidebarOpen(false)}
        />
      </aside>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
