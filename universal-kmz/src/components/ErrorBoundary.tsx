import { Component, type ReactNode } from 'react';

let latestWorkspaceSnapshot: unknown = null;

export function publishWorkspaceSnapshot(snapshot: unknown) {
  latestWorkspaceSnapshot = snapshot;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // O projeto não usa @types/react; os tipos vêm do JS do React, que não expõe `props` na classe.
  declare readonly props: ErrorBoundaryProps;
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleDownloadWorkspace = () => {
    if (latestWorkspaceSnapshot === null) return;

    const blob = new Blob([JSON.stringify(latestWorkspaceSnapshot, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'workspace-universal-kmz-recuperacao.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-6" role="alert">
        <section className="w-full max-w-lg space-y-5 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Falha inesperada</p>
            <h1 className="text-xl font-bold text-slate-900">Não foi possível continuar o workspace.</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              Recarregue a aplicação para tentar novamente. Se os dados já estavam carregados, você pode baixar o último JSON disponível antes de recarregar.
            </p>
          </div>

          {this.state.error.message && (
            <p className="rounded border border-rose-100 bg-rose-50 p-3 text-xs text-rose-800">
              Detalhe: {this.state.error.message}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-indigo-700 bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-700"
            >
              Recarregar aplicação
            </button>
            {latestWorkspaceSnapshot !== null && (
              <button
                type="button"
                onClick={this.handleDownloadWorkspace}
                className="rounded border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
              >
                Baixar JSON do workspace
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }
}
