/** Home without a repository: presentation, opening a wiki, recent wikis, creation (§9.1). */
import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpenText,
  Brain,
  FolderGit2,
  GitFork,
  Highlighter,
  MessageSquare,
  Plus,
  Settings,
} from "lucide-react";
import { listRecents, type RecentWiki } from "../lib/db.ts";
import { formatRelative } from "../lib/format.ts";
import { href, openRepo } from "../lib/router.ts";
import { parseRepo } from "../lib/repo.ts";

export function HomeView() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentWiki[]>([]);
  useEffect(() => {
    listRecents().then(setRecents, () => setRecents([]));
  }, []);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const ref = parseRepo(value);
    if (!ref) {
      setError("Give a GitHub repository as owner/name, or its URL.");
      return;
    }
    openRepo(ref);
  };

  return (
    <div className="home">
      <section className="oe-hero">
        <div className="oe-container oe-stack">
          <div className="home__brand">
            <img src={`${import.meta.env.BASE_URL}icons/mark.svg`} alt="" />
            <div>
              <span className="oe-eyebrow">openEugenia</span>
              <h1 className="oe-display" style={{ margin: 0 }}>
                Eugenia
              </h1>
            </div>
          </div>
          <p className="oe-tagline">Extract, structure and durably remember your knowledge.</p>
          <p className="home__lead">
            Your personal wiki lives in your own git repositories: a private repository for
            everything, a public one for what you choose to share. Eugenia helps you extract
            knowledge, describe each sub-wiki and review with quizzes.
          </p>
        </div>
      </section>

      <div className="oe-container">
        <div className="home__grid">
          <form className="oe-card" onSubmit={submit}>
            <h2 className="oe-card__title">
              <FolderGit2
                aria-hidden="true"
                style={{ display: "inline", verticalAlign: "-0.15em" }}
              />{" "}
              Open a wiki
            </h2>
            <div className="oe-field">
              <label className="oe-label" htmlFor="repo">
                GitHub repository
              </label>
              <input
                id="repo"
                className="oe-input"
                placeholder="owner/name or https://github.com/…"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="oe-help">
                A public repository can be read without an account. For your private repository,
                first add a GitHub token in the <a href={href({ name: "settings" })}>settings</a>.
              </span>
              {error && (
                <span className="oe-help" style={{ color: "var(--oe-color-danger)" }}>
                  {error}
                </span>
              )}
            </div>
            <div className="actions actions--start">
              <button type="submit" className="oe-button">
                Open
              </button>
            </div>
          </form>

          <div className="oe-card">
            <h2 className="oe-card__title">Recent wikis</h2>
            {recents.length === 0 ? (
              <p className="muted">The wikis you open will appear here, available even offline.</p>
            ) : (
              <ul className="link-list">
                {recents.slice(0, 8).map((r) => (
                  <li key={r.key}>
                    <BookOpenText aria-hidden="true" />
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        const ref = parseRepo(r.repo);
                        if (ref) openRepo(ref);
                      }}
                    >
                      {r.title}
                    </a>
                    <span className="muted small">
                      {r.repo} · {r.mode === "owner" ? "owner" : "public"} ·{" "}
                      {formatRelative(r.openedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="oe-card oe-card--featured">
            <h2 className="oe-card__title">Create your wiki</h2>
            <p className="oe-card__body">
              Create an empty <strong>private</strong> GitHub repository, then initialize a wiki in
              it with the default categories. A free GitHub account is enough.
            </p>
            <div className="actions actions--start">
              <a className="oe-button" href={href({ name: "new-wiki" })}>
                <Plus aria-hidden="true" /> New wiki
              </a>
              <a className="oe-button oe-button--ghost" href={href({ name: "settings" })}>
                <Settings aria-hidden="true" /> Settings
              </a>
            </div>
            <p className="oe-help">
              On the command line: <code>eugenia init --github</code> also creates the public
              repository and its automatic publication.
            </p>
          </div>
        </div>

        <div className="features">
          <div className="oe-card">
            <strong className="oe-card__title">
              <Highlighter
                aria-hidden="true"
                style={{ display: "inline", verticalAlign: "-0.15em" }}
              />{" "}
              Extraction
            </strong>
            <p className="oe-card__body">
              Eugenia highlights the atomic knowledge of your notes, articles and PDFs, proposes
              questions, and files it into categories.
            </p>
          </div>
          <div className="oe-card">
            <strong className="oe-card__title">
              <GitFork aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
              Personal wiki
            </strong>
            <p className="oe-card__body">
              A tree of sub-wikis, each described by Eugenia from the most specific to the most
              general, public or private.
            </p>
          </div>
          <div className="oe-card">
            <strong className="oe-card__title">
              <Brain aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
              Review
            </strong>
            <p className="oe-card__body">
              Conversational quizzes, a mastery that decays over time, and reminders so as not to
              forget.
            </p>
          </div>
          <div className="oe-card">
            <strong className="oe-card__title">
              <MessageSquare
                aria-hidden="true"
                style={{ display: "inline", verticalAlign: "-0.15em" }}
              />{" "}
              Discussions
            </strong>
            <p className="oe-card__body">
              Explore a page further with Eugenia, or ask your whole knowledge tree.
            </p>
          </div>
        </div>
        <p className="muted small" style={{ paddingBottom: "2rem" }}>
          Free software (MIT license) ·{" "}
          <a
            href="https://github.com/openEugenia/eugenia"
            target="_blank"
            rel="noopener noreferrer"
          >
            source code
          </a>{" "}
          · version {__APP_VERSION__} · your data stays in your repositories and in this browser.
        </p>
      </div>
    </div>
  );
}
