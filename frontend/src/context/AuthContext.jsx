import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api, { setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(''); // shuru mein server tak pahunch hi nahi paye
  const [sessionExpired, setSessionExpired] = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
    if (user) setSessionExpired(false);
  }, [user]);

  async function refreshUser() {
    try {
      const res = await api.get('/auth/session');
      setUser(res.data.user);
      setBootError('');
    } catch (err) {
      setUser(null);
      // 401 = bas login nahi hai (normal). Baaki sab = server tak pahunch nahi paye, ye "login nahi" nahi hai
      if (err.response?.status === 401) setBootError('');
      else setBootError(err.response?.data?.error || "Can't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshUser();
  }, []);

  // Login ke baad kisi API par 401 aaya: user ko login par bhejo (ProtectedRoute karega)
  const markSessionExpired = useCallback(() => {
    if (!userRef.current) return;
    setSessionExpired(true);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(markSessionExpired);
    return () => setUnauthorizedHandler(null);
  }, [markSessionExpired]);

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Server na mile to bhi is browser se to logout kar do
    }
    setUser(null);
  }

  function retry() {
    setBootError('');
    setLoading(true);
    refreshUser();
  }

  if (bootError) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: '40px' }}>📡</div>
          <h2 style={styles.title}>Can't connect</h2>
          <p style={styles.text}>{bootError}</p>
          <button style={styles.button} onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout, refreshUser, sessionExpired, markSessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

const styles = {
  page: { background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
  card: { background: '#1a1a1a', borderRadius: '12px', padding: '32px', textAlign: 'center', maxWidth: '380px', width: '100%' },
  title: { color: 'white', margin: '10px 0 8px' },
  text: { color: '#aaa', fontSize: '14px', margin: '0 0 20px' },
  button: { padding: '12px 24px', background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
};