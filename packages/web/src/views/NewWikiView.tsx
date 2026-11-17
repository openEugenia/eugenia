/**
 * Création d'un wiki depuis l'application (§8.1, §9.1) : initialise un dépôt GitHub privé
 * (vide ou sans wiki) avec la configuration, la racine et les catégories par défaut.
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
  const [title, setTitle] = useState("Mon wiki");
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
    if (!token) return setError("Ajoutez d'abord un jeton GitHub dans les paramètres.");
    if (!ref) return setError("Indiquez le dépôt sous la forme propriétaire/nom.");
    const gh = new GitHubClient(token);
    try {
      setBusy("Vérification du dépôt…");
      const info = await gh.getRepo(ref);
      if (!info.private)
        throw new Error(
          "Ce dépôt est public : un wiki Eugenia doit être créé dans un dépôt privé.",
        );
      if (!info.canPush) throw new Error("Votre jeton ne permet pas d'écrire dans ce dépôt.");
      const branch = info.defaultBranch || "main";
      let head = await gh.getBranchHead(ref, branch);
      if (head) {
        const files = await gh.getTree(ref, await gh.getCommitTree(ref, head));
        if (files.some((f) => f.path === CONFIG_PATH))
          throw new Error("Ce dépôt contient déjà un wiki Eugenia : ouvrez-le directement.");
      }
      const target = parseRepo(publicRepo || defaultPublic);
      const files = scaffoldWiki({
        title: title.trim() || "Mon wiki",
        categories: categories ? DEFAULT_CATEGORIES : [],
        privateRepo: repoLabel(ref),
        ...(workflow && target ? { publicRepo: repoLabel(target) } : {}),
        branch,
      });
      const message = "Initialisation du wiki Eugenia";
      setBusy("Création des fichiers…");
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
        // Sans la permission « Workflows », GitHub refuse le fichier de workflow.
        if (err instanceof GitHubError && files.has(PUBLISH_WORKFLOW_PATH)) {
          files.delete(PUBLISH_WORKFLOW_PATH);
          await commitFiles(files);
          toast(
            "Le workflow de publication n'a pas pu être créé (permission « Workflows » du jeton) : ajoutez-le avec la CLI.",
            "error",
          );
        } else {
          throw err;
        }
      }
      toast("Wiki créé.", "success");
      // Le dépôt déjà ouvert (vide) doit être relu ; sinon on l'ouvre.
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
        ← Accueil
      </a>
      <h1>Nouveau wiki</h1>
      <p className="muted">
        Le wiki est créé dans un dépôt GitHub <strong>privé</strong> que vous possédez : créez-le
        d'abord sur{" "}
        <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
          github.com/new
        </a>{" "}
        (privé, sans fichier), puis donnez accès à ce dépôt à votre jeton.
      </p>
      {!token && (
        <InfoBox kind="warning" title="Jeton GitHub requis">
          Ajoutez un jeton fine-grained dans les <a href={href({ name: "settings" })}>paramètres</a>
          .
        </InfoBox>
      )}
      <form className="form-grid section" onSubmit={(e) => void create(e)}>
        <div className="oe-field">
          <label className="oe-label" htmlFor="repo">
            Dépôt privé
          </label>
          <input
            id="repo"
            className="oe-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="votre-compte/eugenia-wiki"
            required
          />
        </div>
        <div className="oe-field">
          <label className="oe-label" htmlFor="title">
            Titre du wiki
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
            Créer les {DEFAULT_CATEGORIES.length} catégories par défaut (
            {DEFAULT_CATEGORIES.slice(0, 4).join(", ")}…)
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={workflow}
            onChange={(e) => setWorkflow(e.target.checked)}
          />
          <span>Ajouter la publication automatique vers un dépôt public</span>
        </label>
        {workflow && (
          <div className="oe-field">
            <label className="oe-label" htmlFor="public">
              Dépôt public
            </label>
            <input
              id="public"
              className="oe-input"
              value={publicRepo}
              onChange={(e) => setPublicRepo(e.target.value)}
              placeholder={defaultPublic || "votre-compte/eugenia-wiki-public"}
            />
            <span className="oe-help">
              La publication a besoin d'une clé de déploiement et d'un secret :{" "}
              <code>eugenia init --github</code> les crée, ou suivez la documentation de
              publication.
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
            <CheckCircle2 aria-hidden="true" /> Créer le wiki
          </button>
        </div>
      </form>
    </div>
  );
}
