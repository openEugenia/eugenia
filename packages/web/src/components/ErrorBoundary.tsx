import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBox } from "./common.tsx";

interface State {
  error: Error | null;
}

/**
 * Shows an error instead of a blank page, for example when a view cannot be loaded offline
 * before the app is cached.
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
        <ErrorBox title={chunk ? "View unavailable" : "Something went wrong"}>
          <p>
            {chunk
              ? "This part of the app could not be loaded: you may be offline and it is not cached yet."
              : error.message}
          </p>
          <div className="actions actions--start" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </ErrorBox>
      </div>
    );
  }
}
