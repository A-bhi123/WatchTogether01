import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function ProtectedRoute({ children }) {
  const { user, loading, sessionExpired } = useAuth();

  if (loading) {
    return <div style={{ background: '#0a0a0a', minHeight: '100vh' }} />;
  }
  if (!user) {
    // Session beech mein expire hui ho to login page par batao kyun bheja
    return (
      <Navigate
        to="/login"
        replace
        state={sessionExpired ? { notice: 'Your session expired. Please log in again.' } : undefined}
      />
    );
  }
  return children;
}

export default ProtectedRoute;