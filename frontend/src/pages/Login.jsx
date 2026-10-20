import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../services/api';
import AuthLayout from '../components/AuthLayout';
import { AuthField, PasswordInput } from '../components/AuthFields';
import { MailIcon } from '../components/icons';

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const notice = location.state?.notice || ''; // jaise "Your session expired..."

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/login', form);
      navigate('/verify-otp?purpose=login');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Sign In" subtitle="Welcome back">
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}

      <form onSubmit={handleSubmit}>
        <AuthField
          icon={<MailIcon />}
          type="email"
          name="email"
          placeholder="Email address"
          autoComplete="email"
          value={form.email}
          onChange={handleChange}
          required
        />
        <PasswordInput
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          value={form.password}
          onChange={handleChange}
          required
        />

        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <p className="auth-footer">
        <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
      </p>
      <p className="auth-footer" style={{ marginTop: '8px' }}>
        Don't have an account? <Link to="/register" className="auth-link">Create one</Link>
      </p>
    </AuthLayout>
  );
}

export default Login;