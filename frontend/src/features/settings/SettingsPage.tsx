import { Ban, LoaderCircle, LockKeyhole, ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { formatDateTime, getInitials, resolveMediaUrl } from '../../lib/utils';
import { ApiError } from '../../services/api';
import type { BlockedUser, PendingReport, ReportSummary } from '../../types/api';

export function SettingsPage() {
  const { api } = useAuth();

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadPage = async () => {
    const [blockedResponse, reportsResponse, pendingResponse] = await Promise.all([
      api.getBlockedUsers(),
      api.getMyReports(),
      api.getPendingReports(),
    ]);

    setBlockedUsers(blockedResponse.blocked_users);
    setReports(reportsResponse.reports);
    setPendingReports(pendingResponse.reports);
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await loadPage();
      } catch (cause) {
        if (!cancelled && cause instanceof ApiError) {
          setError(cause.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unblockUser = async (userId: string) => {
    setBusyUserId(userId);
    setError('');

    try {
      await api.unblockUser(userId);
      await loadPage();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      }
    } finally {
      setBusyUserId(null);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordSaving(true);
    setError('');
    setSuccess('');

    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password updated successfully.');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="page-stack">
      {error ? <div className="notice notice--error">{error}</div> : null}
      {success ? <div className="notice notice--success">{success}</div> : null}

      <section className="content-grid">
        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Account security</div>
              <h3>Change password against backend hash validation</h3>
            </div>
            <div className="status-pill status-pill--live">Protected</div>
          </div>

          <form className="form-grid" onSubmit={changePassword}>
            <label className="field">
              <span>Current password</span>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>New password</span>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>

            <label className="field">
              <span>Confirm password</span>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>

            <button className="button button--primary" type="submit" disabled={passwordSaving}>
              {passwordSaving ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Updating password...
                </>
              ) : (
                <>
                  <LockKeyhole size={16} />
                  Save password
                </>
              )}
            </button>
          </form>
        </article>

        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Pending moderation</div>
              <h3>Reports currently open against you</h3>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={18} />
              <span>Loading moderation status...</span>
            </div>
          ) : pendingReports.length === 0 ? (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <span>No pending reports.</span>
            </div>
          ) : (
            <div className="list-stack">
              {pendingReports.map((report) => (
                <div key={report.id} className="report-row">
                  <div>
                    <strong>{report.reason.replaceAll('_', ' ')}</strong>
                    <span>{formatDateTime(report.created_at)}</span>
                  </div>
                  <TriangleAlert size={16} />
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="content-grid">
        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Blocked users</div>
              <h3>Directly managed via match endpoints</h3>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={18} />
              <span>Loading blocked users...</span>
            </div>
          ) : blockedUsers.length === 0 ? (
            <div className="empty-state">
              <Ban size={18} />
              <span>No blocked users at the moment.</span>
            </div>
          ) : (
            <div className="list-stack">
              {blockedUsers.map((blocked) => {
                const avatar = resolveMediaUrl(blocked.avatar_url);
                const label = blocked.display_name || 'Blocked user';

                return (
                  <div key={blocked.id} className="blocked-row">
                    <div className="session-row__identity">
                      {avatar ? (
                        <img className="session-row__avatar" src={avatar} alt={label} />
                      ) : (
                        <div className="session-row__fallback">{getInitials(label)}</div>
                      )}
                      <div>
                        <strong>{label}</strong>
                        <span>Blocked {formatDateTime(blocked.blocked_at)}</span>
                      </div>
                    </div>

                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={busyUserId === blocked.id}
                      onClick={() => unblockUser(blocked.id)}
                    >
                      <Undo2 size={16} />
                      {busyUserId === blocked.id ? 'Removing...' : 'Unblock'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Reports you created</div>
              <h3>Audit trail from `/api/v1/reports/my-reports`</h3>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={18} />
              <span>Loading reports...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <span>You have not submitted reports yet.</span>
            </div>
          ) : (
            <div className="list-stack">
              {reports.map((report) => (
                <div key={report.id} className="report-row">
                  <div>
                    <strong>{report.reason.replaceAll('_', ' ')}</strong>
                    <span>{formatDateTime(report.created_at)}</span>
                  </div>
                  <div className="status-pill">{report.status}</div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
