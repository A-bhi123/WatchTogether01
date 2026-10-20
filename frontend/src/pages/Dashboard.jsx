import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Navbar from '../components/Navbar';

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
  const units = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60],
  ];
  for (const [label, secs] of units) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value} ${label}${value > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [notice, setNotice] = useState(location.state?.notice || '');
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null); // jis room par 🗑 dabaya
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function loadRooms() {
    try {
      const res = await api.get('/rooms/my-rooms');
      setRooms(res.data.rooms);
      setLoadError('');
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Could not load your rooms.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const res = await api.post('/rooms', { name: roomName.trim() });
      navigate(`/room/${res.data.room.room_code}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create room');
    } finally {
      setCreating(false);
    }
  }

  function handleCopy(e, code, id) {
    e.stopPropagation(); // card click (rejoin) trigger na ho
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  }

  function askDelete(e, room) {
    e.stopPropagation(); // card click (room kholna) trigger na ho
    setDeleteError('');
    setDeleteTarget(room);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/rooms/${deleteTarget.room_code}`);
      setNotice(
        deleteTarget.is_host
          ? `Room "${deleteTarget.name}" was deleted.`
          : `Room "${deleteTarget.name}" was removed from your list.`
      );
      setDeleteTarget(null);
      await loadRooms(); // list dobara laao, taaki list mein jagah banne par agla purana room bhi aa jaye
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete the room. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={styles.page}>
      <Navbar />
      <div style={styles.content}>
        {notice && (
          <div style={styles.noticeBar}>
            <span>{notice}</span>
            <button style={styles.noticeClose} onClick={() => setNotice('')}>✕</button>
          </div>
        )}

        <h1 style={styles.heading}>
          Welcome back, <span style={styles.name}>{user?.name}</span>
        </h1>
        <p style={styles.subtext}>Create a room or join one to start watching together</p>

        <div style={styles.cardRow}>
          <button style={{ ...styles.actionCard, ...styles.createCard }} onClick={() => setShowModal(true)}>
            <div style={{ ...styles.actionIcon, background: '#e01e1e' }}>+</div>
            <h3 style={styles.actionTitle}>Create Room</h3>
            <p style={styles.actionText}>Start a new watch party and invite your friends</p>
          </button>

          <button style={{ ...styles.actionCard, ...styles.joinCard }} onClick={() => navigate('/join-room')}>
            <div style={{ ...styles.actionIcon, background: '#333' }}>→</div>
            <h3 style={styles.actionTitle}>Join Room</h3>
            <p style={styles.actionText}>Enter a room code to join your friends</p>
          </button>
        </div>

        <h2 style={styles.sectionTitle}>🕐 Recent Rooms</h2>

        {loading ? (
          <p style={styles.subtext}>Loading...</p>
        ) : loadError ? (
          <div style={styles.emptyState}>
            <p style={{ color: '#ff9b9b', marginBottom: '14px' }}>{loadError}</p>
            <button style={styles.createButton} onClick={loadRooms}>Try again</button>
          </div>
        ) : rooms.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>▦</div>
            <p style={styles.subtext}>No rooms yet — create one to get started!</p>
          </div>
        ) : (
          <div style={styles.roomGrid}>
            {rooms.map((room) => (
              <div key={room.id} style={styles.roomCard} onClick={() => navigate(`/room/${room.room_code}`)}>
                <div style={styles.roomCardTop}>
                  <span style={styles.roomCardName}>{room.name}</span>
                  <div style={styles.roomCardActions}>
                    <button
                      style={styles.iconButton}
                      onClick={(e) => handleCopy(e, room.room_code, room.id)}
                      title="Copy room code"
                    >
                      {copiedId === room.id ? '✓' : '⧉'}
                    </button>
                    <button
                      style={styles.iconButton}
                      onClick={(e) => askDelete(e, room)}
                      title={room.is_host ? 'Delete room' : 'Remove from my list'}
                      aria-label={room.is_host ? 'Delete room' : 'Remove from my list'}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <div style={styles.roomCardMeta}>
                  <span style={styles.codeBadge}>{room.room_code}</span>
                  <span style={styles.memberCount}>👥 {room.member_count}</span>
                  {room.status !== 'active' && <span style={styles.endedBadge}>Ended</span>}
                </div>
                <div style={styles.roomCardTime}>{timeAgo(room.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div style={styles.overlay} onClick={() => !creating && setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Create a Room</h2>
            {error && <p style={styles.error}>{error}</p>}
            <form onSubmit={handleCreate}>
              <input
                style={styles.modalInput}
                type="text"
                placeholder="Room name (e.g. Movie Night 🎬)"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={60}
                autoFocus
                required
              />
              <div style={styles.modalButtonRow}>
                <button type="button" style={styles.cancelButton} onClick={() => setShowModal(false)} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" style={styles.createButton} disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={styles.overlay} onClick={() => !deleting && setDeleteTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              {deleteTarget.is_host ? 'Delete this room?' : 'Remove this room?'}
            </h2>
            <p style={styles.modalText}>
              {deleteTarget.is_host
                ? `"${deleteTarget.name}" will be deleted for everyone: its chat, the uploaded movie and all members. Anyone inside right now will be sent out. This cannot be undone.`
                : `"${deleteTarget.name}" will be removed from your list only. You can join it again later with the room code.`}
            </p>
            {deleteError && <p style={styles.error}>{deleteError}</p>}
            <div style={styles.modalButtonRow}>
              <button style={styles.cancelButton} onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button style={styles.dangerButton} onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Please wait...' : deleteTarget.is_host ? 'Delete room' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { background: '#0a0a0a', minHeight: '100vh' },
  content: { padding: '32px clamp(16px, 4vw, 40px)', maxWidth: '1400px', margin: '0 auto' },
  heading: { color: 'white', fontSize: 'clamp(24px, 6vw, 32px)', marginBottom: '6px' },
  name: { color: '#e01e1e' },
  subtext: { color: '#999', marginBottom: '28px', fontSize: '15px' },
  cardRow: { display: 'flex', gap: '16px', marginBottom: '40px', flexWrap: 'wrap' },
  actionCard: { flex: '1 1 320px', textAlign: 'left', padding: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  createCard: { background: '#2a0e0e' },
  joinCard: { background: '#1a1a1a' },
  actionIcon: { width: '40px', height: '40px', borderRadius: '10px', color: 'white', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' },
  actionTitle: { color: 'white', margin: '0 0 6px', fontSize: '19px' },
  actionText: { color: '#999', margin: 0, fontSize: '14px' },
  sectionTitle: { color: 'white', fontSize: '19px', marginBottom: '18px' },
  emptyState: { textAlign: 'center', padding: '48px 0' },
  emptyIcon: { fontSize: '32px', color: '#444', marginBottom: '10px' },

  noticeBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#3a2a0a', color: '#f0c36b', padding: '12px 16px', borderRadius: '8px', marginBottom: '18px', fontSize: '14px' },
  noticeClose: { background: 'none', border: 'none', color: '#f0c36b', cursor: 'pointer', fontSize: '15px' },

  roomGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '18px' },
  roomCard: { background: '#141414', border: '1px solid #222', borderRadius: '10px', padding: '18px', cursor: 'pointer' },
  roomCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' },
  roomCardName: { color: 'white', fontWeight: 'bold', fontSize: '16px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  roomCardActions: { display: 'flex', gap: '2px', flexShrink: 0 },
  iconButton: { background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '15px', padding: '4px 7px' },
  roomCardMeta: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' },
  codeBadge: { background: '#262626', color: '#ccc', fontSize: '12px', fontFamily: 'monospace', padding: '3px 8px', borderRadius: '5px', letterSpacing: '0.5px' },
  memberCount: { color: '#999', fontSize: '13px' },
  endedBadge: { background: '#3a1a1a', color: '#ff9b9b', fontSize: '11px', padding: '2px 8px', borderRadius: '10px' },
  roomCardTime: { color: '#666', fontSize: '12px' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#1a1a1a', padding: '28px', borderRadius: '12px', width: '420px', maxWidth: '92vw' },
  modalTitle: { color: 'white', marginBottom: '16px' },
  modalText: { color: '#aaa', fontSize: '14px', lineHeight: 1.5, margin: '0 0 18px' },
  modalInput: { width: '100%', padding: '12px', background: '#262626', border: '1px solid #e01e1e', borderRadius: '8px', color: 'white', fontSize: '16px', marginBottom: '18px' },
  modalButtonRow: { display: 'flex', gap: '10px' },
  cancelButton: { flex: 1, padding: '12px', background: '#262626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  createButton: { flex: 1, padding: '12px', background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  dangerButton: { flex: 1, padding: '12px', background: '#c01818', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  error: { color: '#ff6b6b', marginBottom: '10px' },
};

export default Dashboard;