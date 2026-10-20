import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function OtpVerify() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();

  // Purpose URL se aata hai (?purpose=login), isliye refresh ya naya tab kholne par bhi yaad rehta hai
  const rawPurpose = searchParams.get('purpose');
  const purpose = rawPurpose === 'register' || rawPurpose === 'login' ? rawPurpose : null;

  const [digits, setDigits] = useState(Array(6).fill(''));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [booting, setBooting] = useState(true); // server se status aane tak
  const [maskedEmail, setMaskedEmail] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const inputRefs = useRef([]);

  // Samay ka asli maalik server hai. Hum bas "kab tak" yaad rakhte hain aur har baar abhi se uska fark dikhate hain
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const verifyUrl = purpose === 'register' ? '/auth/verify-register-otp' : '/auth/verify-otp';
  const resendUrl = purpose === 'register' ? '/auth/resend-register-otp' : '/auth/resend-otp';

  const handleSessionError = useCallback(
    (err) => {
      const code = err.response?.data?.code;
      if (code === 'LOGIN_EXPIRED' || code === 'REGISTER_EXPIRED') {
        setTimeout(() => navigate(purpose === 'register' ? '/register' : '/login', { replace: true }), 1500);
      }
    },
    [navigate, purpose]
  );

  // Server se poocho: is OTP mein kitne second bache, kitni koshish bachi, resend kab tak band
  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/auth/otp-status', { params: { purpose } });
      const data = res.data;
      const received = Date.now();
      setMaskedEmail(data.maskedEmail);
      setExpiresAt(received + data.expiresInSeconds * 1000);
      setResendAt(received + data.resendInSeconds * 1000);
      setAttemptsLeft(data.exists ? data.attemptsLeft : null);
      setNow(received);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
      handleSessionError(err);
    } finally {
      setBooting(false);
    }
  }, [purpose, handleSessionError]);

  useEffect(() => {
    if (!purpose) {
      navigate('/login', { replace: true });
      return;
    }
    loadStatus();
  }, [purpose, navigate, loadStatus]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // Tab chhod kar wapas aao to server se dobara pooch lo (browser background tab ke timers dheere kar deta hai)
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === 'visible' && purpose) loadStatus();
    }
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [purpose, loadStatus]);

  // Ek ya kai digit ek box se daalo (type, paste ya phone ka autofill). Baaki box apne aap bhar jate hain
  function fillFrom(index, rawValue) {
    const clean = rawValue.replace(/\D/g, '');
    const next = [...digits];

    if (!clean) {
      next[index] = '';
      setDigits(next);
      return;
    }

    let position = index;
    for (const char of clean) {
      if (position > 5) break;
      next[position] = char;
      position += 1;
    }
    setDigits(next);
    inputRefs.current[Math.min(position, 5)]?.focus();
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = Array(6).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function handleVerify(e) {
    e.preventDefault();
    const otp = digits.join('');
    if (otp.length !== 6) {
      setError('Enter all 6 digits');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post(verifyUrl, { otp });
      setUser(res.data.user);

      // Invite link se aaye the to login ke baad seedha wahi room
      const pendingCode = sessionStorage.getItem('pendingJoinCode');
      if (pendingCode) {
        sessionStorage.removeItem('pendingJoinCode');
        try {
          const joinRes = await api.post(`/rooms/${pendingCode}/join`);
          navigate(`/room/${joinRes.data.room.code}`, { replace: true });
          return;
        } catch {
          // Join fail hui (room delete ho gaya shayad), normal dashboard par bhej do
        }
      }

      navigate('/dashboard', { replace: true });
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || 'Something went wrong');
      if (data?.code === 'EXPIRED') setExpiresAt(Date.now());
      if (data?.code === 'TOO_MANY_ATTEMPTS') setAttemptsLeft(0);
      handleSessionError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setResending(true);
    try {
      await api.post(resendUrl);
      setDigits(Array(6).fill(''));
      await loadStatus(); // naya expiry aur resend ka gap server se
      inputRefs.current[0]?.focus();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not resend OTP');
      handleSessionError(err);
    } finally {
      setResending(false);
    }
  }

  if (!purpose) return null;

  const expired = secondsLeft === 0;
  const noAttempts = attemptsLeft === 0;
  const canVerify = !loading && !expired && !noAttempts;

  return (
    <AuthLayout title={`Verify Your ${purpose === 'register' ? 'Email' : 'Login'}`}>
      {booting ? (
        <p className="auth-text">Checking your code...</p>
      ) : (
        <>
          {maskedEmail && (
            <p className="auth-text">
              We sent a 6-digit code to <strong>{maskedEmail}</strong>
            </p>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <form onSubmit={handleVerify}>
            <div className="otp-row" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => (inputRefs.current[i] = el)}
                  className="otp-box"
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  aria-label={`Digit ${i + 1} of 6`}
                  value={digit}
                  onChange={(e) => fillFrom(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onFocus={(e) => e.target.select()}
                  disabled={expired || noAttempts}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            <button type="submit" className="auth-button" disabled={!canVerify}>
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
          </form>

          <p className={`auth-timer${expired ? ' auth-timer--expired' : ''}`}>
            {noAttempts
              ? 'Too many wrong attempts. Please request a new code.'
              : expired
                ? 'OTP expired. Please request a new code.'
                : `Expires in ${formatTime(secondsLeft)}${
                    attemptsLeft !== null && attemptsLeft < 5 ? ` · ${attemptsLeft} attempts left` : ''
                  }`}
          </p>

          <p className="auth-footer" style={{ marginTop: '8px' }}>
            <button
              type="button"
              className="auth-linkbutton"
              onClick={handleResend}
              disabled={resending || resendLeft > 0}
            >
              {resending
                ? 'Sending...'
                : resendLeft > 0
                  ? `Resend OTP in ${resendLeft}s`
                  : "Didn't receive the code? Resend OTP"}
            </button>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

export default OtpVerify;