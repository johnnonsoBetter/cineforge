import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmail } from './auth.js';
import Logo from './components/Logo.jsx';

// The sign-in page (route: /login) — shown only when auth is enabled and no one is signed
// in. Reuses the hero's look so it reads as the same product, not a bolted-on login page.
export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | error string
  const [sent, setSent] = useState(false);

  const send = async () => {
    const addr = email.trim();
    if (!addr || status === 'sending') return;
    setStatus('sending');
    try {
      await signInWithEmail(addr);
      setSent(true);
      setStatus(null);
    } catch (e) {
      setStatus(e.message || 'Could not send the link.');
    }
  };

  return (
    <div className="landing authpage">
      <header className="lnav">
        <div className="lnav-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }} title="Home">
          <Logo variant="icon" className="lnav-logo" />
          <span className="brand-mark">CineForge</span>
          <span className="brand-sub">AI Film Studio</span>
        </div>
        <div className="lnav-right">
          <button className="btn" onClick={() => navigate('/')}>← Back to home</button>
        </div>
      </header>
      <div className="authbox">
        <div className="hero-inner">
          <Logo variant="lockup" className="hero-logo" />
          <div className="hero-sub">Sign in to open your films and pick up where you left off.</div>

          <div className="hero-card login-card">
            {sent ? (
              <div className="login-sent">
                Check <strong>{email.trim()}</strong> for a magic link. Open it on this device
                to sign in.
              </div>
            ) : (
              <>
                <input
                  className="login-input"
                  type="email"
                  autoFocus
                  placeholder="you@studio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                />
                <div className="hero-foot">
                  <div className="hero-foot-meta">We'll email you a one-time sign-in link.</div>
                  <button
                    className="btn-gold"
                    onClick={send}
                    disabled={!email.trim() || status === 'sending'}
                  >
                    {status === 'sending' ? 'Sending…' : 'Send magic link →'}
                  </button>
                </div>
                {status && status !== 'sending' && <div className="login-error">{status}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
