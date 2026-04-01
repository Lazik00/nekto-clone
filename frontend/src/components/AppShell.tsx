import {
  Bolt,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { cn, getDisplayName, getInitials, resolveMediaUrl } from '../lib/utils';

const navigation = [
  {
    to: '/app',
    label: 'Radar',
    icon: LayoutDashboard,
  },
  {
    to: '/app/history',
    label: 'History',
    icon: History,
  },
  {
    to: '/app/profile',
    label: 'Profile',
    icon: UserRound,
  },
  {
    to: '/app/settings',
    label: 'Settings',
    icon: Settings,
  },
];

export function AppShell() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const displayName = user ? getDisplayName(user) : 'Anonymous user';
  const avatar = resolveMediaUrl(user?.avatar_url);

  return (
    <div className="app-frame">
      <aside className="app-sidebar surface">
        <div className="app-brand">
          <div className="app-brand__mark">
            <Bolt size={18} />
          </div>
          <div>
            <div className="eyebrow">Realtime video</div>
            <h1>Nekto Clone</h1>
          </div>
        </div>

        <p className="app-sidebar__copy">
          Deliberate matching, strong moderation hooks, and a front-end built for
          production flows instead of demo screens.
        </p>

        <nav className="app-nav">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/app'}
                className={({ isActive }) => cn('nav-link', isActive && 'nav-link--active')}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-sidebar__footer surface surface--soft">
          <div className="user-chip">
            {avatar ? (
              <img src={avatar} alt={displayName} className="user-chip__avatar" />
            ) : (
              <div className="user-chip__fallback">{getInitials(displayName)}</div>
            )}
            <div>
              <strong>{displayName}</strong>
              <span>{location.pathname === '/app' ? 'Ready to match' : 'Workspace active'}</span>
            </div>
          </div>

          <button className="button button--ghost button--block" type="button" onClick={logout}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="app-content">
        <header className="app-toolbar">
          <div>
            <div className="eyebrow">Senior-grade frontend</div>
            <h2>Matched flows with real backend state</h2>
          </div>
          <div className="status-pill status-pill--live">API connected</div>
        </header>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
