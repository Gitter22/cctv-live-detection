import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/auth';

export function LoginPage() {
  const { me, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) {
    const to = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={to} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit} aria-label="Sign in">
        <div className="brand brand-lg">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>Vigil</span>
        </div>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
