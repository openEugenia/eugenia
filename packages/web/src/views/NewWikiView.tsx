/**
 * Creating a wiki from the app (§8.1, §9.1): initializes a private GitHub repository (empty or
 * without a wiki) with the configuration, the root and the default categories.
 */
import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  CONFIG_PATH,
  DEFAULT_CATEGORIES,
  PUBLISH_WORKFLOW_PATH,
  scaffoldWiki,
} from "@openeugenia/core";
import { ErrorBox, InfoBox, Spinner } from "../components/common.tsx";
import { GitHubClient, GitHubError } from "../lib/github.ts";
import { currentRepo, href, navigate, openRepo } from "../lib/router.ts";
import { parseRepo, repoLabel, sameRepo } from "../lib/repo.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

export function NewWikiView() {
  const token = useSettings((s) => s.settings.githubToken);
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("My wiki");
  const [categories, setCategories] = useState(true);
  const [workflow, setWorkflow] = useState(true);
  const [publicRepo, setPublicRepo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ref = parseRepo(repo);
  const defaultPublic = ref ? `${repoLabel(ref)}-public` : "";

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!token) return setError("First add a GitHub token in the settings.");
    if (!ref) return setError("Give the repository as owner/name.");
    const gh = new GitHubClient(token);
    try {
      setBusy("Checking the repository…");
      const info = await gh.getRepo(ref);
      if (!info.private)
        throw new Error(
          "This repository is public: an Eugenia wiki must be created in a private one.",
        );
      if (!info.canPush) throw new Error("Your token does not allow writing to this repository.");
      const branch = info.defaultBranch || "main";
      let head = await gh.getBranchHead(ref, branch);
      if (head) {
        const files = await gh.getTree(ref, await gh.getCommitTree(ref, head));
        if (files.some((f) => f.path === CONFIG_PATH))
          throw new Error("This repository already contains an Eugenia wiki: open it directly.");
      }
      const target = parseRepo(publicRepo || defaultPublic);
      const files = scaffoldWiki({
        title: title.trim() || "My wiki",
        categories: categories ? DEFAULT_CATEGORIES : [],
        privateRepo: repoLabel(ref),
        ...(workflow && target ? { publicRepo: repoLabel(target) } : {}),
        branch,
      });
      const message = "Initialize the Eugenia wiki";
      setBusy("Creating the files…");
      if (!head) {
        head = await gh.createFile(ref, CONFIG_PATH, files.get(CONFIG_PATH)!, message, branch);
        files.delete(CONFIG_PATH);
      }
      const commitFiles = async (entries: Map<string, string>): Promise<void> => {
        const base = await gh.getCommitTree(ref, head!);
        const tree = await gh.createTree(
          ref,
          base,
          [...entries].map(([path, content]) => ({
            path,
            mode: "100644" as const,
            type: "blob" as const,
            content,
          })),
        );
        const commit = await gh.createCommit(ref, message, tree, [head!]);
        await gh.updateRef(ref, branch, commit);
        head = commit;
      };
      try {
        await commitFiles(files);
      } catch (err) {
        // Without the "Workflows" permission, GitHub refuses the workflow file.
        if (err instanceof GitHubError && files.has(PUBLISH_WORKFLOW_PATH)) {
          files.delete(PUBLISH_WORKFLOW_PATH);
          await commitFiles(files);
          toast(
            'The publication workflow could not be created (the token lacks the "Workflows" permission): add it with the CLI.',
            "error",
          );
        } else {
          throw err;
        }
      }
      toast("Wiki created.", "success");
      // The repository already open (empty) must be read again; otherwise open it.
      if (sameRepo(currentRepo(), ref)) {
        navigate({ name: "root" });
        await useWiki.getState().open(ref);
      } else {
        openRepo(ref);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <a
        href="./"
        className="small"
        onClick={(e) => {
          e.preventDefault();
          openRepo(null);
        }}
      >
        ← Home
      </a>
      <h1>New wiki</h1>
      <p className="muted">
        The wiki is created in a <strong>private</strong> GitHub repository that you own: first
        create it on{" "}
        <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
          github.com/new
        </a>{" "}
        (private, without files), then give your token access to this repository.
      </p>
      {!token && (
        <InfoBox kind="warning" title="GitHub token required">
          Add a fine-grained token in the <a href={href({ name: "settings" })}>settings</a>.
        </InfoBox>
      )}
      <form className="form-grid section" onSubmit={(e) => void create(e)}>
        <div className="oe-field">
          <label className="oe-label" htmlFor="repo">
            Private repository
          </label>
          <input
            id="repo"
            className="oe-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="your-account/eugenia-wiki"
            required
          />
        </div>
        <div className="oe-field">
          <label className="oe-label" htmlFor="title">
            Wiki title
          </label>
          <input
            id="title"
            className="oe-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={categories}
            onChange={(e) => setCategories(e.target.checked)}
          />
          <span>
            Create the {DEFAULT_CATEGORIES.length} default categories (
            {DEFAULT_CATEGORIES.slice(0, 4).join(", ")}…)
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={workflow}
            onChange={(e) => setWorkflow(e.target.checked)}
          />
          <span>Add automatic publication to a public repository</span>
        </label>
        {workflow && (
          <div className="oe-field">
            <label className="oe-label" htmlFor="public">
              Public repository
            </label>
            <input
              id="public"
              className="oe-input"
              value={publicRepo}
              onChange={(e) => setPublicRepo(e.target.value)}
              placeholder={defaultPublic || "your-account/eugenia-wiki-public"}
            />
            <span className="oe-help">
              Publication needs a deploy key and a secret: <code>eugenia init --github</code>{" "}
              creates them, or follow the publication documentation.
            </span>
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="actions">
          {busy && (
            <span
              className="small muted"
              style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}
            >
              <Spinner small /> {busy}
            </span>
          )}
          <button type="submit" className="oe-button" disabled={Boolean(busy) || !token}>
            <CheckCircle2 aria-hidden="true" /> Create the wiki
          </button>
        </div>
      </form>
    </div>
  );
}
