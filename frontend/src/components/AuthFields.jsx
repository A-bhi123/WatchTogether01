import { useState } from 'react';
import { LockIcon, EyeIcon, EyeOffIcon } from './icons';

// Icon wala input. Baaki saare props (type, name, value, onChange...) seedha input ko jate hain
export function AuthField({ icon, ...inputProps }) {
  return (
    <div className="auth-field">
      {icon && <span className="auth-icon">{icon}</span>}
      <input className={`auth-input${icon ? ' has-icon' : ''}`} {...inputProps} />
    </div>
  );
}

// Password input: lock icon aur show/hide ki aankh
export function PasswordInput(inputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-field">
      <span className="auth-icon">
        <LockIcon />
      </span>
      <input
        className="auth-input has-icon has-toggle"
        type={visible ? 'text' : 'password'}
        {...inputProps}
      />
      <button
        type="button"
        className="auth-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}