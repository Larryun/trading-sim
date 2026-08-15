import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render-time errors so a single failure can't white-screen the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Simulator render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 600, margin: '80px auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#e5e5e5' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
          <p style={{ color: '#aaa' }}>The simulator hit a rendering error. Reload to start a fresh market.</p>
          <pre style={{ background: '#0f0f1e', border: '1px solid #2a2a3a', borderRadius: 8, padding: 12, fontSize: 12, overflow: 'auto', color: '#f87171' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
