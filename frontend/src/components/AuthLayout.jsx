import '../styles/auth.css';

// Auth wale saare pages ka common dhancha: brand + card
function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="auth-brand-icon">▦</span>
        <span className="auth-brand-name">WATCHTOGETHER</span>
      </div>
      {subtitle && <p className="auth-tagline">{subtitle}</p>}

      <div className="auth-card">
        {title && <h1 className="auth-title">{title}</h1>}
        {children}
      </div>
    </div>
  );
}

export default AuthLayout;