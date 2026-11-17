/** Accueil sans dépôt : présentation, ouverture d'un wiki, wikis récents, création (§9.1). */
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
      setError("Indiquez un dépôt GitHub sous la forme propriétaire/nom, ou son adresse.");
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
          <p className="oe-tagline">
            Extraire, structurer et mémoriser durablement vos connaissances.
          </p>
          <p className="home__lead">
            Votre wiki personnel vit dans vos propres dépôts git : un dépôt privé pour tout, un
            dépôt public pour ce que vous choisissez de partager. Eugenia vous aide à en extraire
            des connaissances, à décrire chaque sous-wiki et à réviser par des quiz.
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
              Ouvrir un wiki
            </h2>
            <div className="oe-field">
              <label className="oe-label" htmlFor="repo">
                Dépôt GitHub
              </label>
              <input
                id="repo"
                className="oe-input"
                placeholder="propriétaire/nom ou https://github.com/…"
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
                Un dépôt public se lit sans compte. Pour votre dépôt privé, ajoutez d'abord un jeton
                GitHub dans les <a href={href({ name: "settings" })}>paramètres</a>.
              </span>
              {error && (
                <span className="oe-help" style={{ color: "var(--oe-color-danger)" }}>
                  {error}
                </span>
              )}
            </div>
            <div className="actions actions--start">
              <button type="submit" className="oe-button">
                Ouvrir
              </button>
            </div>
          </form>

          <div className="oe-card">
            <h2 className="oe-card__title">Wikis récents</h2>
            {recents.length === 0 ? (
              <p className="muted">
                Les wikis que vous ouvrez apparaîtront ici, consultables même hors ligne.
              </p>
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
                      {r.repo} · {r.mode === "owner" ? "propriétaire" : "public"} ·{" "}
                      {formatRelative(r.openedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="oe-card oe-card--featured">
            <h2 className="oe-card__title">Créer votre wiki</h2>
            <p className="oe-card__body">
              Créez un dépôt GitHub <strong>privé</strong> et vide, puis initialisez-y un wiki avec
              les catégories par défaut. Un compte GitHub gratuit suffit.
            </p>
            <div className="actions actions--start">
              <a className="oe-button" href={href({ name: "new-wiki" })}>
                <Plus aria-hidden="true" /> Nouveau wiki
              </a>
              <a className="oe-button oe-button--ghost" href={href({ name: "settings" })}>
                <Settings aria-hidden="true" /> Paramètres
              </a>
            </div>
            <p className="oe-help">
              En ligne de commande : <code>eugenia init --github</code> crée aussi le dépôt public
              et sa publication automatique.
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
              Eugenia surligne les connaissances atomiques de vos notes, articles et PDF, et propose
              questions et catégories.
            </p>
          </div>
          <div className="oe-card">
            <strong className="oe-card__title">
              <GitFork aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
              Wiki personnel
            </strong>
            <p className="oe-card__body">
              Un arbre de sous-wikis, chacun décrit par Eugenia du plus fin au plus global, public
              ou privé.
            </p>
          </div>
          <div className="oe-card">
            <strong className="oe-card__title">
              <Brain aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
              Révision
            </strong>
            <p className="oe-card__body">
              Des quiz conversationnels, une maîtrise qui décline avec le temps et des rappels pour
              ne pas oublier.
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
              Approfondissez une page avec Eugenia, ou interrogez tout votre arbre de connaissances.
            </p>
          </div>
        </div>
        <p className="muted small" style={{ paddingBottom: "2rem" }}>
          Logiciel libre (licence MIT) ·{" "}
          <a
            href="https://github.com/openEugenia/eugenia"
            target="_blank"
            rel="noopener noreferrer"
          >
            code source
          </a>{" "}
          · version {__APP_VERSION__} · vos données restent dans vos dépôts et dans ce navigateur.
        </p>
      </div>
    </div>
  );
}
