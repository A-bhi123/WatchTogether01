import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import AuthLayout from '../components/AuthLayout';
import { AuthField, PasswordInput } from '../components/AuthFields';
import { UserIcon, MailIcon } from '../components/icons';

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', form);
      navigate('/verify-otp?purpose=register');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Create Account" subtitle="Create your free account">
      {error && <p className="auth-error" role="alert">{error}</p>}

      <form onSubmit={handleSubmit}>
        <AuthField
          icon={<UserIcon />}
          name="name"
          placeholder="Your name"
          autoComplete="name"
          maxLength={100}
          value={form.name}
          onChange={handleChange}
          required
        />
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
          autoComplete="new-password"
          value={form.password}
          onChange={handleChange}
          required
        />
        <p className="auth-hint">At least 8 characters, with letters and numbers.</p>

        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? 'Creating...' : 'Create Account'}
        </button>
      </form>

      <p className="auth-footer">
        Already have an account? <Link to="/login" className="auth-link">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export default Register;