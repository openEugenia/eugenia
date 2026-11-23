/** Application: choice of the view according to the open repository and the route. */
import { lazy, Suspense, useEffect } from "react";
import { reminders } from "@openeugenia/core";
import { AppShell } from "./components/AppShell.tsx";
import { ErrorBox, Loading } from "./components/common.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { DialogHost, Toasts } from "./components/Modal.tsx";
import { href, openRepo, useRepoParam, useRoute, type Route } from "./lib/router.ts";
import { discussionViewKey } from "./lib/discussions.ts";
import { repoKey, repoLabel } from "./lib/repo.ts";
import { useSettings } from "./store/settings.ts";
import { toast } from "./store/ui.ts";
import { useWiki } from "./store/wiki.ts";
import { HomeView } from "./views/HomeView.tsx";
import { NodeView } from "./views/NodeView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";

const EditorView = lazy(() =>
  import("./views/EditorView.tsx").then((m) => ({ default: m.EditorView })),
);
const ExtractionView = lazy(() =>
  import("./views/ExtractionView.tsx").then((m) => ({ default: m.ExtractionView })),
);
const QuizView = lazy(() => import("./views/QuizView.tsx").then((m) => ({ default: m.QuizView })));
const DiscussionView = lazy(() =>
  import("./views/DiscussionView.tsx").then((m) => ({ default: m.DiscussionView })),
);
const AskView = lazy(() => import("./views/AskView.tsx").then((m) => ({ default: m.AskView })));
const GraphView = lazy(() =>
  import("./views/GraphView.tsx").then((m) => ({ default: m.GraphView })),
);
const DashboardView = lazy(() =>
  import("./views/DashboardView.tsx").then((m) => ({ default: m.DashboardView })),
);
const SearchView = lazy(() =>
  import("./views/SearchView.tsx").then((m) => ({ default: m.SearchView })),
);
const ChangesView = lazy(() =>
  import("./views/ChangesView.tsx").then((m) => ({ default: m.ChangesView })),
);
const SummariesView = lazy(() =>
  import("./views/SummariesView.tsx").then((m) => ({ default: m.SummariesView })),
);
const LibraryView = lazy(() =>
  import("./views/LibraryView.tsx").then((m) => ({ default: m.LibraryView })),
);
const DiscussionsView = lazy(() =>
  import("./views/DiscussionsView.tsx").then((m) => ({ default: m.DiscussionsView })),
);
const NewWikiView = lazy(() =>
  import("./views/NewWikiView.tsx").then((m) => ({ default: m.NewWikiView })),
);

function routeNodeId(route: Route): string | undefined {
  switch (route.name) {
    case "node":
    case "edit":
    case "extract":
    case "quiz":
    case "ask":
    case "graph":
    case "summaries":
      return route.id;
    case "new":
      return route.parentId;
    case "discussion":
      return route.about;
    default:
      return undefined;
  }
}

function WikiRoute({ route }: { route: Route }) {
  const rootId = useWiki((s) => s.derived?.tree.rootId);
  const libraryId = useWiki((s) => s.derived?.tree.libraryId);
  switch (route.name) {
    case "root":
      return rootId ? <NodeView id={rootId} key={rootId} /> : null;
    case "node":
      // The library root is the list of sources.
      return route.id === libraryId ? <LibraryView /> : <NodeView id={route.id} key={route.id} />;
    case "library":
      return (
        <LibraryView
          {...(route.kind ? { kind: route.kind } : {})}
          {...(route.q ? { q: route.q } : {})}
        />
      );
    case "discussions":
      return (
        <DiscussionsView
          {...(route.kind ? { kind: route.kind } : {})}
          {...(route.q ? { q: route.q } : {})}
        />
      );
    case "edit":
      return <EditorView mode="edit" id={route.id} key={`edit-${route.id}`} />;
    case "new":
      return (
        <EditorView
          mode="new"
          parentId={route.parentId}
          type={route.type}
          key={`new-${route.parentId}-${route.type}`}
        />
      );
    case "extract":
      return (
        <ExtractionView
          {...(route.id ? { id: route.id } : {})}
          {...(route.discussion ? { discussion: route.discussion } : {})}
          key={`extract-${route.id ?? ""}-${route.discussion ?? ""}`}
        />
      );
    case "quiz":
      return <QuizView id={route.id} key={`quiz-${route.id}`} />;
    case "discussion":
      return (
        <DiscussionView
          {...(route.path ? { path: route.path } : {})}
          {...(route.about ? { about: route.about } : {})}
          {...(route.kind ? { kind: route.kind } : {})}
          key={discussionViewKey(route)}
        />
      );
    case "ask":
      return <AskView {...(route.id ? { id: route.id } : {})} key={`ask-${route.id ?? ""}`} />;
    case "graph":
      return <GraphView {...(route.id ? { id: route.id } : {})} />;
    case "dashboard":
      return <DashboardView />;
    case "search":
      return <SearchView {...(route.q ? { q: route.q } : {})} />;
    case "settings":
      return <SettingsView />;
    case "changes":
      return <ChangesView />;
    case "summaries":
      return <SummariesView {...(route.id ? { rootId: route.id } : {})} />;
    case "new-wiki":
      return <NewWikiView />;
    default:
      return (
        <div className="page">
          <ErrorBox title="Page not found">
            This address does not match any view.{" "}
            <a href={href({ name: "root" })}>Back to the wiki</a>.
          </ErrorBox>
        </div>
      );
  }
}

function useTheme(): void {
  const theme = useSettings((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}

export function App() {
  const loaded = useSettings((s) => s.loaded);
  const token = useSettings((s) => s.settings.githubToken);
  const repo = useRepoParam();
  const route = useRoute();
  const status = useWiki((s) => s.status);
  const error = useWiki((s) => s.error);
  const message = useWiki((s) => s.message);
  const derived = useWiki((s) => s.derived);
  const workspace = useWiki((s) => s.workspace);
  useTheme();

  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  const key = repo ? repoKey(repo) : null;
  useEffect(() => {
    if (!loaded) return;
    if (repo) void useWiki.getState().open(repo);
    else useWiki.getState().close();
    // Reopen when the token changes: the access mode may change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded, token]);

  // Review reminders when the wiki opens (§8.3).
  useEffect(() => {
    if (!derived || workspace?.mode !== "owner") return;
    const groups = reminders(
      derived.tree,
      derived.mastery,
      derived.config.mastery.reminder_threshold,
    );
    const first = groups[0];
    if (first) {
      const count = first.cards.length;
      toast(
        `${count} flashcard${count === 1 ? "" : "s"} in "${first.category.title}" may be forgotten.`,
      );
    }
    // Only once each time a wiki opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.key, derived !== null]);

  useEffect(() => {
    const node =
      derived && routeNodeId(route) ? derived.tree.nodes.get(routeNodeId(route)!) : undefined;
    document.title = derived
      ? `${node ? `${node.title} — ` : ""}${derived.config.title} · Eugenia`
      : "Eugenia";
  }, [derived, route]);

  let content;
  if (!loaded) {
    content = <Loading />;
  } else if (!repo) {
    content =
      route.name === "settings" ? (
        <div className="main" style={{ height: "100%" }}>
          <SettingsView />
        </div>
      ) : route.name === "new-wiki" ? (
        <div className="main" style={{ height: "100%" }}>
          <Suspense fallback={<Loading />}>
            <NewWikiView />
          </Suspense>
        </div>
      ) : (
        <HomeView />
      );
  } else if (status === "error") {
    content = (
      <div className="main" style={{ height: "100%" }}>
        <div className="page">
          <h1>{repoLabel(repo)}</h1>
          <ErrorBox title="Cannot open this wiki">{error}</ErrorBox>
          <div className="actions actions--start" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="oe-button"
              onClick={() => void useWiki.getState().open(repo)}
            >
              Try again
            </button>
            <a className="oe-button oe-button--ghost" href={href({ name: "settings" })}>
              Settings
            </a>
            <button
              type="button"
              className="oe-button oe-button--ghost"
              onClick={() => openRepo(null)}
            >
              Home
            </button>
          </div>
          {route.name === "settings" && <SettingsView />}
        </div>
      </div>
    );
  } else if (status !== "ready" || !derived) {
    content = <Loading message={message} />;
  } else if (derived.empty) {
    content = (
      <AppShell>
        <div className="page">
          <ErrorBox title="This repository does not contain a wiki yet">
            Initialize it from <a href={href({ name: "new-wiki" })}>the wiki creation page</a> or
            with <code>eugenia init</code>.
          </ErrorBox>
          {route.name === "new-wiki" && (
            <Suspense fallback={<Loading />}>
              <NewWikiView />
            </Suspense>
          )}
          {route.name === "settings" && <SettingsView />}
        </div>
      </AppShell>
    );
  } else {
    content = (
      <AppShell {...(routeNodeId(route) ? { currentId: routeNodeId(route)! } : {})}>
        <ErrorBoundary resetKey={location.hash}>
          <Suspense fallback={<Loading />}>
            <WikiRoute route={route} />
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    );
  }

  return (
    <>
      {content}
      <DialogHost />
      <Toasts />
    </>
  );
}
