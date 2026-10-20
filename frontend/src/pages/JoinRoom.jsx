import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import AuthLayout from '../components/AuthLayout';

// Code ya poora invite link, dono chalte hain: link paste karo to uska aakhri hissa (code) hi rakhte hain
function extractCode(text) {
  const last = text.trim().split('/').filter(Boolean).pop() || '';
  return last.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
}

function JoinRoom() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!code) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post(`/rooms/${code}/join`);
      navigate(`/room/${res.data.room.code}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not join room');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Join Room">
      <p className="auth-text">Enter the room code, or paste the invite link your friend sent.</p>

      {error && <p className="auth-error" role="alert">{error}</p>}

      <form onSubmit={handleSubmit}>
        <input
          className="auth-input auth-input--code"
          type="text"
          placeholder="e.g. X4A099"
          aria-label="Room code"
          autoComplete="off"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(extractCode(e.target.value))}
          autoFocus
          required
        />
        <button type="submit" className="auth-button" disabled={loading || !code}>
          {loading ? 'Joining...' : 'Join Room'}
        </button>
      </form>

      <p className="auth-footer">
        <Link to="/dashboard" className="auth-link">← Back to Dashboard</Link>
      </p>
    </AuthLayout>
  );
}

export default JoinRoom;