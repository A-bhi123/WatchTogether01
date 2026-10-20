import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Navbar.css';

function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="navbar">
      <button className="navbar-brand" onClick={() => navigate('/dashboard')} aria-label="Go to dashboard">
        <span className="navbar-logo">▦</span>
        <span className="navbar-title">WATCHTOGETHER</span>
      </button>

      <div className="navbar-user">
        <div className="navbar-avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
        <span className="navbar-name">{user?.name}</span>
        <button className="navbar-signout" onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}

export default Navbar;