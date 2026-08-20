import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: '#0f0f1a',
            color: '#e0e0e0',
            padding: 24,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22 }}>页面出错了</h1>
          <pre
            style={{
              maxWidth: '100%',
              overflow: 'auto',
              padding: 12,
              background: '#1e1e2e',
              border: '1px solid #3a3a5e',
              borderRadius: 8,
              fontSize: 13,
              whiteSpace: 'pre-wrap',
            }}
          >
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
