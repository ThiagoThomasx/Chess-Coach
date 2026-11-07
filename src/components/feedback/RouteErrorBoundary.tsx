import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { EmptyState } from './EmptyState';

type Props = {
  /** Changing this key (the current route) clears the error, so navigating away recovers. */
  resetKey: string;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Catches render errors of one screen so the app never turns into a blank
 * page: the navigation stays usable and the stored data is untouched.
 * (React only supports error boundaries as class components.)
 */
export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-only diagnostics (no telemetry): visible in the browser console.
    console.error('ChessQuest: erro ao exibir a tela', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page" role="alert" data-testid="route-error">
        <EmptyState
          icon={<TriangleAlert size={36} />}
          title="Não foi possível exibir esta tela"
          action={
            <div className="row">
              {/* Also clears the error when the failing screen is the dashboard itself (same path). */}
              <Link className="btn btn-primary" to="/" onClick={() => this.setState({ error: null })}>
                Voltar ao dashboard
              </Link>
              <button className="btn" type="button" onClick={() => this.setState({ error: null })}>
                Tentar de novo
              </button>
            </div>
          }
        >
          Um dado desta tela não pôde ser lido. Seus dados continuam salvos neste dispositivo; as outras áreas do ChessQuest seguem funcionando.
        </EmptyState>
      </div>
    );
  }
}
