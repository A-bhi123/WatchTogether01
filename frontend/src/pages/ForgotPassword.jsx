import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import AuthLayout from '../components/AuthLayout';
import { AuthField, PasswordInput } from '../components/AuthFields';
import { MailIcon } from '../components/icons';

function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = email, 2 = OTP + naya password, 3 = ho gaya
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestOtp(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setMessage(res.data.message);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { email, otp, newPassword });
      setMessage(res.data.message);
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Forgot Password">
      {step === 1 && (
        <>
          <p className="auth-text">Enter your email and we will send you a 6-digit code.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <form onSubmit={requestOtp}>
            <AuthField
              icon={<MailIcon />}
              type="email"
              placeholder="Your registered email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <>
          {message && <p className="auth-success" role="status">{message}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <form onSubmit={resetPassword}>
            <input
              className="auth-input auth-input--code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              aria-label="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <PasswordInput
              placeholder="New password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="auth-hint">At least 8 characters, with letters and numbers.</p>
            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>

          <p className="auth-footer" style={{ marginTop: '10px' }}>
            <button type="button" className="auth-linkbutton" onClick={requestOtp} disabled={loading}>
              Send the code again
            </button>
            <button type="button" className="auth-linkbutton" onClick={() => { setStep(1); setError(''); }}>
              Use a different email
            </button>
          </p>
        </>
      )}

      {step === 3 && (
        <>
          <p className="auth-success" role="status">{message}</p>
          <button className="auth-button" onClick={() => navigate('/login')}>Go to Sign In</button>
        </>
      )}

      {step !== 3 && (
        <p className="auth-footer">
          Remembered it? <Link to="/login" className="auth-link">Sign in</Link>
        </p>
      )}
    </AuthLayout>
  );
}

export default ForgotPassword;