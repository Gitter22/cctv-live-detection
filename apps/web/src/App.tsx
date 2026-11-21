import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/auth';
import { OrgIndexRedirect, OrgLayout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';

/** Only signed-in users get past this; others go to /login and come back afterwards. */
function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

const Soon = ({ what }: { what: string }) => <p className="muted">{what}: coming in the next task.</p>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<OrgIndexRedirect />} />
        <Route path="/admin" element={<Soon what="Platform admin" />} />
        <Route path="/o/:orgId" element={<OrgLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="alerts" element={<Soon what="Alerts" />} />
          <Route path="cameras" element={<Soon what="Cameras" />} />
          <Route path="cameras/:cameraId" element={<Soon what="Camera" />} />
          <Route path="rules" element={<Soon what="Rules" />} />
          <Route path="settings" element={<Soon what="Settings" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
