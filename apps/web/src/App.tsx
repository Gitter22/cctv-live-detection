import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/auth';
import { LoginPage } from './pages/Login';

/** Only signed-in users get past this; others go to /login and come back afterwards. */
function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function Home() {
  const { me, logout } = useAuth();
  return (
    <div className="center">
      <div className="card">
        <h1>Welcome, {me?.user.name}</h1>
        <button className="btn" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/*" element={<Home />} />
      </Route>
    </Routes>
  );
}
