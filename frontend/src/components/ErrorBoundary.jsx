import { Component } from 'react';

// React ka koi component render mein crash kare to poora page blank na ho, ye bachata hai.
// (Ye sirf render ke errors pakadta hai, button-click ya async errors alag se try/catch se sambhalte hain.)
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: '40px' }}>😵</div>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.text}>The page ran into an unexpected problem. Reloading usually fixes it.</p>
          <div style={styles.row}>
            <button style={styles.primary} onClick={() => window.location.reload()}>Reload page</button>
            <button
              style={styles.secondary}
              onClick={() => {
                window.location.href = '/dashboard';
              }}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const styles = {
  page: { background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
  card: { background: '#1a1a1a', borderRadius: '12px', padding: '32px', textAlign: 'center', maxWidth: '400px', width: '100%' },
  title: { color: 'white', margin: '10px 0 8px' },
  text: { color: '#aaa', fontSize: '14px', margin: '0 0 20px' },
  row: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' },
  primary: { padding: '12px 20px', background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  secondary: { padding: '12px 20px', background: '#262626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

export default ErrorBoundary;