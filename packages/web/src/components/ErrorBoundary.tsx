import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBox } from "./common.tsx";

interface State {
  error: Error | null;
}

/**
 * Affiche une erreur au lieu d'une page blanche, par exemple quand une vue ne peut pas
 * être chargée hors ligne avant que l'application soit mise en cache.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override componentDidUpdate(previous: { resetKey?: string }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk =
      /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(
        error.message,
      );
    return (
      <div className="page">
        <ErrorBox title={chunk ? "Vue indisponible" : "Une erreur est survenue"}>
          <p>
            {chunk
              ? "Cette partie de l'application n'a pas pu être chargée : vous êtes peut-être hors ligne et elle n'est pas encore en cache."
              : error.message}
          </p>
          <div className="actions actions--start" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => this.setState({ error: null })}
            >
              Réessayer
            </button>
          </div>
        </ErrorBox>
      </div>
    );
  }
}
