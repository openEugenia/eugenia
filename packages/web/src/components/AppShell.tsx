/**
 * App shell: top bar, side panel with three spaces (wiki, library, discussions), content.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListTree,
  X,
  CloudOff,
  FolderTree,
  Globe,
  LayoutDashboard,
  Library,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
} from "lucide-react";
import {
  discussionsInBranch,
  isInBranch,
  librarySources,
  type SourceIndexNode,
  type WikiNode,
} from "@openeugenia/core";
import { useSourceIndex } from "../lib/indexing.ts";
import { useTasks } from "../lib/tasks.ts";
import { formatDate } from "../lib/format.ts";
import { uncommittedPaths } from "../lib/pending.ts";
import { href, navigate, openRepo, useRoute, type Route } from "../lib/router.ts";
import { normalizeTerm } from "../lib/text.ts";
import type { Derived } from "../lib/workspace.ts";
import { canEdit, useWiki } from "../store/wiki.ts";
import {
  DiscussionKindIcon,
  RecordBadge,
  SourceKindIcon,
  Spinner,
  VisibilityBadge,
} from "./common.tsx";
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
  let label = "Up to date";
  if (pending.conflicts.length > 0) {
    className += " is-conflict";
    label = `${pending.conflicts.length} conflict(s)`;
  } else if (!online || offline) {
    className += " is-offline";
    label = count > 0 ? `Offline · ${count} pending` : "Offline";
  } else if (syncing) {
    label = "Synchronizing…";
  } else if (count > 0) {
    className += " is-pending";
    label = uncommitted > 0 ? `${uncommitted} change(s) to save` : `${count} queued`;
  }
  return (
    <a
      className={`oe-button oe-button--ghost oe-button--sm ${className}`}
      href={href({ name: "changes" })}
      title="Changes and synchronization"
    >
      {syncing ? (
        <Spinner small label="Synchronizing" />
      ) : !online || offline ? (
        <CloudOff aria-hidden="true" />
      ) : (
        <span className="dot" aria-hidden="true" />
      )}
      <span className="app-bar__label">{label}</span>
    </a>
  );
}

/** Eugenia's tasks running in the background: progress, link to the tasks. */
function TasksIndicator() {
  const tasks = useTasks((s) => s.tasks);
  const finished = useTasks((s) => s.finished);
  const list = Object.values(tasks);
  if (list.length === 0) return null;
  const total = finished + list.length;
  const kinds = new Set(list.map((t) => t.kind));
  const label = kinds.size > 1 ? "Eugenia" : kinds.has("index") ? "Indexing" : "Descriptions";
  return (
    <a
      className="oe-button oe-button--ghost oe-button--sm"
      href={href({ name: "tasks" })}
      title="Eugenia's tasks in the background"
    >
      <Spinner small label="Eugenia is working" />
      <span className="app-bar__label">
        {label} {finished}/{total}
      </span>
    </a>
  );
}

/** Index of the open source, in the library panel: its sections, collapsible like the wiki. */
function IndexTree({
  source,
  currentSection,
  onNavigate,
}: {
  source: WikiNode;
  currentSection: string | undefined;
  onNavigate(): void;
}) {
  const { index } = useSourceIndex(source);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // The open section is always visible: its ancestors are expanded.
  useEffect(() => {
    if (!currentSection) return;
    const parts = currentSection.split("/");
    const chain = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
    setOpen((prev) => (chain.every((k) => prev.has(k)) ? prev : new Set([...prev, ...chain])));
  }, [currentSection]);
  if (!index || index.root.children.length === 0) return null;
  const render = (nodes: readonly SourceIndexNode[]): ReactNode => (
    <ul className="tree">
      {nodes.map((n) => {
        const expanded = open.has(n.key);
        const current = n.key === currentSection;
        return (
          <li key={n.key}>
            <div className={`tree-row${current ? " is-current" : ""}`}>
              {n.children.length > 0 ? (
                <button
                  type="button"
                  className="tree-toggle"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(n.key)) next.delete(n.key);
                      else next.add(n.key);
                      return next;
                    })
                  }
                  aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </button>
              ) : (
                <span className="tree-spacer" />
              )}
              <a
                href={href({ name: "node", id: source.id, section: n.key })}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
              >
                <ListTree aria-hidden="true" />
                <span className="title">{n.name}</span>
              </a>
            </div>
            {expanded && n.children.length > 0 && render(n.children)}
          </li>
        );
      })}
    </ul>
  );
  return <div aria-label={`Index of ${source.title}`}>{render(index.root.children)}</div>;
}

export type Section = "wiki" | "library" | "discussions";

const SIDEBAR_KEY = "eugenia:sidebar";

/** Space matching the open page. */
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
  { id: "library", label: "Library", icon: <Library aria-hidden="true" /> },
  { id: "discussions", label: "Discussions", icon: <MessagesSquare aria-hidden="true" /> },
];

/** Library in the side panel: sources by title, quick filter. */
function LibraryPanel({
  derived,
  currentId,
  currentSection,
  branchId,
  owner,
  onNavigate,
}: {
  derived: Derived;
  currentId: string | undefined;
  /** Open section of the index of the current source. */
  currentSection: string | undefined;
  /** Only the sources filed in this branch (library filtered by category). */
  branchId: string | undefined;
  owner: boolean;
  onNavigate(): void;
}) {
  const [filter, setFilter] = useState("");
  const branch = branchId ? derived.tree.nodes.get(branchId) : undefined;
  const sources = useMemo(
    () =>
      librarySources(derived.tree)
        .filter((s) => !branch || isInBranch(derived.tree, branch.id, s))
        .sort((a, b) => a.title.localeCompare(b.title, "en")),
    [derived.tree, branch],
  );
  const q = normalizeTerm(filter.trim());
  const visible = q
    ? sources.filter((s) => normalizeTerm(`${s.title} ${s.authors.join(" ")}`).includes(q))
    : sources;
  return (
    <div className="side-panel">
      {branch && (
        <a
          className="chip is-active side-panel__filter"
          href={href({ name: "library" })}
          onClick={onNavigate}
          title="Show the whole library"
        >
          In {branch.title} <X aria-hidden="true" className="inline-icon" />
        </a>
      )}
      {sources.length > 8 && (
        <input
          className="oe-input oe-input--sm"
          type="search"
          placeholder="Filter sources…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter sources"
        />
      )}
      {sources.length === 0 ? (
        <p className="muted small side-panel__empty">
          No sources. Add the books, articles and websites your knowledge comes from.
        </p>
      ) : (
        <ul className="tree">
          {visible.map((s) => (
            <li key={s.id}>
              <div
                className={`tree-row${s.id === currentId && !currentSection ? " is-current" : ""}`}
              >
                <span className="tree-spacer" />
                <a
                  href={href({ name: "node", id: s.id })}
                  aria-current={s.id === currentId && !currentSection ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <SourceKindIcon kind={s.sourceKind} />
                  <span className="title">{s.title}</span>
                </a>
                <span className="tree-flags">
                  <span className="muted small" title="Knowledge items citing this source">
                    {derived.knowledgeBySource.get(s.id)?.length ?? 0}
                  </span>
                  {owner && (
                    <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />
                  )}
                  {!owner && !s.isPublic && <RecordBadge compact />}
                </span>
              </div>
              {s.id === currentId && s.sourceIndex?.root && (
                <IndexTree source={s} currentSection={currentSection} onNavigate={onNavigate} />
              )}
            </li>
          ))}
        </ul>
      )}
      <a className="side-panel__more" href={href({ name: "library" })} onClick={onNavigate}>
        Whole library
      </a>
    </div>
  );
}

/** Recent discussions in the side panel. */
function DiscussionsPanel({
  derived,
  currentPath,
  branchId,
  onNavigate,
}: {
  derived: Derived;
  currentPath: string | undefined;
  /** Only the discussions placed in this branch. */
  branchId: string | undefined;
  onNavigate(): void;
}) {
  const branch = branchId ? derived.tree.nodes.get(branchId) : undefined;
  const recent = useMemo(() => {
    if (!branch) return derived.discussions.slice(0, 40);
    const paths = new Set(
      discussionsInBranch(derived.tree, derived.hierarchy, branch.id).map((d) => d.path),
    );
    return derived.discussions.filter((d) => paths.has(d.path)).slice(0, 40);
  }, [derived, branch]);
  return (
    <div className="side-panel">
      {branch && (
        <a
          className="chip is-active side-panel__filter"
          href={href({ name: "discussions" })}
          onClick={onNavigate}
          title="Show all the discussions"
        >
          In {branch.title} <X aria-hidden="true" className="inline-icon" />
        </a>
      )}
      {recent.length === 0 ? (
        <p className="muted small side-panel__empty">
          No discussions. Write a quick note or ask a question about your wiki.
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
                  <span className="title">{d.meta.title || "Untitled"}</span>
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
        All discussions
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
  // On a wide screen, the side tree is optional: the graph is enough (remembered).
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "hidden";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (sidebarHidden) localStorage.setItem(SIDEBAR_KEY, "hidden");
      else localStorage.removeItem(SIDEBAR_KEY);
    } catch {
      // storage unavailable
    }
  }, [sidebarHidden]);
  const [query, setQuery] = useState(route.name === "search" ? (route.q ?? "") : "");
  const routeSection = derived ? sectionFor(route, derived, currentId) : "wiki";
  const [section, setSection] = useState<Section>(routeSection);
  // The tab follows the open page; the user can then switch freely.
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
    <div
      className={`shell${sidebarOpen ? " sidebar-open" : ""}${sidebarHidden ? " no-sidebar" : ""}`}
    >
      <header className="app-bar">
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm icon-only sidebar-toggle"
          aria-label={sidebarHidden ? "Show the side tree" : "Hide the side tree"}
          title={sidebarHidden ? "Show the side tree" : "Hide the side tree"}
          aria-pressed={!sidebarHidden}
          onClick={() => setSidebarHidden((v) => !v)}
        >
          {sidebarHidden ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm icon-only menu-toggle"
          aria-label="Show the tree"
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
          title="Eugenia home"
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
            title="You are viewing the public part of this wiki"
          >
            <Globe aria-hidden="true" /> <span className="app-bar__label">Public</span>
          </span>
        )}
        {owner && !resolved?.canWrite && (
          <span className="oe-badge oe-badge--warning" title={resolved?.readOnlyReason}>
            <AlertTriangle aria-hidden="true" /> <span className="app-bar__label">Read-only</span>
          </span>
        )}
        <form className="app-bar__search" role="search" onSubmit={submit}>
          <input
            className="oe-input"
            type="search"
            placeholder="Search…"
            aria-label="Search the wiki"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <nav className="app-bar__actions" aria-label="Tools">
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "search" })}
            aria-label="Search"
            title="Search"
          >
            <Search />
          </a>
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "ask" })}
            title="Ask a question about the wiki"
          >
            <MessageCircleQuestion aria-hidden="true" />{" "}
            <span className="app-bar__label">Questions</span>
          </a>
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "root" })}
            aria-label="Graph"
            title="Graph of the whole wiki"
          >
            <Network />
          </a>
          {owner && (
            <a
              className="oe-button oe-button--ghost oe-button--sm icon-only"
              href={href({ name: "dashboard" })}
              aria-label="Dashboard"
              title="Dashboard"
            >
              <LayoutDashboard />
            </a>
          )}
          {owner && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "summaries" })}
              title="Sub-wiki descriptions"
            >
              <RefreshCw aria-hidden="true" />
              {staleCount > 0 && (
                <span
                  className="count-badge"
                  aria-label={`${staleCount} stale or missing descriptions`}
                >
                  {staleCount}
                </span>
              )}
            </a>
          )}
          {owner && <TasksIndicator />}
          {owner && <SyncIndicator />}
          <a
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            href={href({ name: "settings" })}
            aria-label="Settings"
            title="Settings"
          >
            <Settings />
          </a>
        </nav>
      </header>
      <aside className="sidebar" aria-label="Wiki spaces">
        <div className="section-tabs" role="tablist" aria-label="Spaces">
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
            {section === "wiki" ? "Knowledge" : section === "library" ? "Sources" : "Recent"}
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
              title="New category"
            >
              <Plus aria-hidden="true" /> Category
            </a>
          )}
          {editable && section === "library" && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({
                name: "new",
                parentId: derived.tree.libraryId,
                type: "source",
                ...(currentId && derived.tree.nodes.get(currentId)?.type === "category"
                  ? { category: currentId }
                  : {}),
              })}
              title="New source"
            >
              <Plus aria-hidden="true" /> Source
            </a>
          )}
          {editable && section === "discussions" && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "discussion", kind: "note" })}
              title="New quick note"
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
            currentSection={route.name === "node" ? route.section : undefined}
            branchId={route.name === "library" ? route.category : undefined}
            owner={owner}
            onNavigate={() => setSidebarOpen(false)}
          />
        )}
        {section === "discussions" && (
          <DiscussionsPanel
            derived={derived}
            currentPath={route.name === "discussion" ? route.path : undefined}
            branchId={route.name === "discussions" ? route.category : undefined}
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
