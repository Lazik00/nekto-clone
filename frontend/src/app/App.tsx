import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { AuthPage } from '../features/auth/AuthPage';
import { ChatRoomPage } from '../features/chat/ChatRoomPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { SettingsPage } from '../features/settings/SettingsPage';

function FullScreenState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="app-loading-screen">
      <div className="app-loading-card surface">
        <div className="eyebrow">Nekto Clone</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function RequireAuth() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <FullScreenState
        title="Session is warming up"
        subtitle="Syncing your profile, tokens, and real-time connection settings."
      />
    );
  }

  if (auth.status !== 'authenticated') {
    return <Navigate to="/auth" replace />;
  }

  return <Outlet />;
}

function RequireGuest() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <FullScreenState
        title="Preparing workspace"
        subtitle="Loading authentication state before we route you further."
      />
    );
  }

  if (auth.status === 'authenticated') {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route element={<RequireGuest />}>
          <Route path="/auth" element={<AuthPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="chat/:sessionId" element={<ChatRoomPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
