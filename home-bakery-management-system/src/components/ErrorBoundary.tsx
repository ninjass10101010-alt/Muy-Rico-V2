import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[Muy Rico] Unhandled UI error:", error, errorInfo.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4 py-10">
        <div
          role="alert"
          aria-live="assertive"
          className="w-full max-w-xl rounded-2xl border border-sand-200 bg-white p-8 shadow-modal"
        >
          <div className="mb-5 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-coral-light"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className="size-6 text-hibiscus"
              >
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </span>
            <h1 className="font-serif text-2xl font-semibold text-palm">
              Something went wrong
              <span className="mt-1 block font-sans text-base font-medium text-cocoa-muted">
                Algo salió mal
              </span>
            </h1>
          </div>

          <p className="mb-6 font-sans text-sm leading-relaxed text-cocoa">
            The dashboard hit an unexpected error. Reload to continue — your data is
            already saved. If it keeps happening, contact the system administrator.
          </p>
          <p className="mb-6 font-sans text-sm leading-relaxed text-cocoa">
            El panel encontró un error inesperado. Recarga la página para continuar; tus
            datos ya están guardados. Si el problema persiste, contacta al administrador.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={this.reload} className="btn-primary flex-1">
              Reload / Recargar
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="btn-secondary flex-1"
            >
              Go home / Inicio
            </button>
          </div>

          {import.meta.env.DEV && (
            <details className="mt-6 rounded-xl bg-sand-50 p-4">
              <summary className="cursor-pointer font-sans text-xs font-semibold text-cocoa-muted">
                Error details (dev only)
              </summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-hibiscus">
                {error.message}
                {errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}