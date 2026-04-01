import {
  ArrowRight,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../services/api';

type Mode = 'login' | 'register';

const featureItems = [
  'Typed backend calls with automatic token refresh.',
  'Live queue state, reports, blocks, and chat history wired to API.',
  'Realtime video room designed for desktop and mobile, not a demo shell.',
];

export function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({
          email,
          username,
          password,
          confirm_password: confirmPassword,
          display_name: displayName || undefined,
        });
      }

      navigate('/app', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-copy">
        <div className="surface surface--glass auth-copy__card">
          <div className="auth-badge">
            <Radar size={18} />
            <span>Senior-grade frontend rebuild</span>
          </div>
          <h1>Launch a real random video chat product, not a placeholder UI.</h1>
          <p>
            This client is built around the actual FastAPI contract: auth, profile,
            match queue, websocket chat, moderation, and history are all wired from day
            one.
          </p>

          <div className="auth-copy__metrics">
            <div className="metric-card">
              <Sparkles size={18} />
              <strong>Polished UX</strong>
              <span>Distinct visual language with responsive flow states.</span>
            </div>
            <div className="metric-card">
              <ShieldCheck size={18} />
              <strong>Safety tooling</strong>
              <span>Block and report actions exposed where users actually need them.</span>
            </div>
            <div className="metric-card">
              <LockKeyhole size={18} />
              <strong>Session control</strong>
              <span>Persistent auth with refresh token recovery and protected routes.</span>
            </div>
          </div>

          <ul className="auth-feature-list">
            {featureItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="surface auth-panel__card">
          <div className="auth-panel__header">
            <div>
              <div className="eyebrow">Account access</div>
              <h2>{mode === 'login' ? 'Welcome back' : 'Create your operator account'}</h2>
            </div>
            <div className="auth-switch">
              <button
                className={mode === 'login' ? 'auth-switch__button auth-switch__button--active' : 'auth-switch__button'}
                type="button"
                onClick={() => setMode('login')}
              >
                Sign in
              </button>
              <button
                className={mode === 'register' ? 'auth-switch__button auth-switch__button--active' : 'auth-switch__button'}
                type="button"
                onClick={() => setMode('register')}
              >
                Join
              </button>
            </div>
          </div>

          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@nekto.app"
                required
              />
            </label>

            {mode === 'register' ? (
              <>
                <label className="field">
                  <span>Username</span>
                  <input
                    className="input"
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="nekto_host"
                    minLength={3}
                    required
                  />
                </label>

                <label className="field">
                  <span>Display name</span>
                  <input
                    className="input"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Sabina"
                  />
                </label>
              </>
            ) : null}

            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter a strong password"
                minLength={6}
                required
              />
            </label>

            {mode === 'register' ? (
              <label className="field">
                <span>Confirm password</span>
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat the password"
                  minLength={6}
                  required
                />
              </label>
            ) : null}

            {error ? <div className="notice notice--error">{error}</div> : null}

            <button className="button button--primary button--block" type="submit" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Enter workspace' : 'Create account'}
              <ArrowRight size={18} />
            </button>

            <p className="field-footnote">
              {mode === 'login'
                ? 'Use the account already registered on this backend.'
                : 'Registration immediately issues access and refresh tokens from backend.'}
            </p>
          </form>

          <div className="auth-footer">
            <UserPlus size={16} />
            <span>
              {mode === 'login'
                ? 'Need a new operator profile? Switch to Join.'
                : 'Already registered? Switch back to Sign in.'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
