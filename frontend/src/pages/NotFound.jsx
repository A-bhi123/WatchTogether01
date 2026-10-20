import { useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';

function NotFound() {
  const navigate = useNavigate();

  return (
    <AuthLayout title="Page not found">
      <p className="auth-text">The page you are looking for does not exist or may have moved.</p>
      <button className="auth-button" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
    </AuthLayout>
  );
}

export default NotFound;