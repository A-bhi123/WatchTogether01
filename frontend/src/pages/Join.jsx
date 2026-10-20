import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

function Join() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return; // auth check poora hone ka wait karo

    if (!user) {
      // Logged out: code yaad rakho, login bhej do. Login/OTP ke baad OtpVerify ise use karega.
      sessionStorage.setItem('pendingJoinCode', code);
      navigate('/login', { replace: true });
      return;
    }

    // Logged in: turant join karo
    async function join() {
      try {
        const res = await api.post(`/rooms/${code}/join`);
        navigate(`/room/${res.data.room.code}`, { replace: true });
      } catch (err) {
        setError(err.response?.data?.error || 'Could not join room');
      }
    }
    join();
  }, [user, authLoading, code, navigate]);

  if (error) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ff6b6b', marginBottom: '16px' }}>{error}</p>
          <button onClick={() => navigate('/dashboard')} style={styles.button}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <p style={{ color: 'white' }}>Joining room...</p>
    </div>
  );
}

const styles = {
  page: { background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  button: { padding: '10px 20px', background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' },
};

export default Join;