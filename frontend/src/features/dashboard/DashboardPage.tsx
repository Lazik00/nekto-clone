import {
  Camera,
  Clock3,
  Globe2,
  LoaderCircle,
  Radar,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { startTransition, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import {
  formatDateTime,
  formatRelativeTime,
  getDisplayName,
  getInitials,
  resolveMediaUrl,
  toNullableNumber,
} from '../../lib/utils';
import { ApiError } from '../../services/api';
import type { MatchPreferences, MatchNotification, QueueStatus, SessionSummary } from '../../types/api';

async function requestPreviewPermissions() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera and microphone access.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });

  stream.getTracks().forEach((track) => track.stop());
}

export function DashboardPage() {
  const { api, user } = useAuth();
  const navigate = useNavigate();

  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [searching, setSearching] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [genderPreference, setGenderPreference] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [countryPreference, setCountryPreference] = useState('');

  const preferences: MatchPreferences = {
    gender_preference: genderPreference ? (genderPreference as MatchPreferences['gender_preference']) : undefined,
    age_min: toNullableNumber(ageMin) ?? undefined,
    age_max: toNullableNumber(ageMax) ?? undefined,
    country_preference: countryPreference.trim() || undefined,
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await api.getChatSessions();
        if (!cancelled) {
          setRecentSessions(response.sessions.slice(0, 4));
        }
      } catch {
        if (!cancelled) {
          setError('Could not load recent sessions.');
        }
      } finally {
        if (!cancelled) {
          setLoadingSessions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!searching) {
      return;
    }

    let active = true;

    const poll = async () => {
      try {
        const [queue, notifications] = await Promise.all([
          api.getQueueStatus().catch(() => null),
          api.getNotifications(),
        ]);

        if (!active) {
          return;
        }

        if (queue) {
          setQueueStatus(queue);
        }

        const matchNotification = notifications.notifications.find(
          (item): item is MatchNotification => item.type === 'match_found',
        );

        if (matchNotification) {
          setSearching(false);
          startTransition(() => {
            navigate(`/app/chat/${matchNotification.session_id}`, {
              state: {
                matchUser: matchNotification.match,
              },
            });
          });
        }
      } catch (cause) {
        if (active && cause instanceof ApiError) {
          setError(cause.message);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  const startMatchmaking = async () => {
    setBusy(true);
    setError('');

    try {
      await requestPreviewPermissions();
      const response = await api.findMatch(preferences);

      if (response.status === 'matched') {
        startTransition(() => {
          navigate(`/app/chat/${response.session_id}`, {
            state: {
              matchUser: response.match,
            },
          });
        });
        return;
      }

      setSearching(true);
      if (response.position) {
        setQueueStatus({
          position: response.position,
          wait_time_seconds: 0,
          estimated_match_in: 0,
        });
      } else {
        setQueueStatus(null);
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      } else if (cause instanceof Error) {
        setError(cause.message);
      } else {
        setError('Unable to start matchmaking.');
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelMatchmaking = async () => {
    setBusy(true);
    try {
      await api.cancelMatchmaking();
      setSearching(false);
      setQueueStatus(null);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-grid">
        <article className="surface surface--hero hero-copy">
          <div className="hero-badge">
            <Sparkles size={16} />
            <span>Production-ready operator deck</span>
          </div>
          <h1>Queue users with intent, then move them into a real-time room.</h1>
          <p>
            Auth is persistent, queue state polls backend, and the match room consumes
            websocket signaling directly from FastAPI.
          </p>

          <div className="stats-grid">
            <div className="metric-card">
              <Radar size={18} />
              <strong>{user?.total_matches ?? 0}</strong>
              <span>Total matches tracked on backend.</span>
            </div>
            <div className="metric-card">
              <ShieldAlert size={18} />
              <strong>{user?.blocked_users_count ?? 0}</strong>
              <span>Blocked users synced from moderation APIs.</span>
            </div>
            <div className="metric-card">
              <Globe2 size={18} />
              <strong>{user?.country || 'Global'}</strong>
              <span>Current profile country used by filters.</span>
            </div>
          </div>
        </article>

        <article className="surface queue-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Live matchmaking</div>
              <h3>{searching ? 'Searching for a compatible user' : 'Ready for the next session'}</h3>
            </div>
            {searching ? <div className="status-pill status-pill--warning">Queue active</div> : null}
          </div>

          <div className="queue-ring">
            <div className={searching ? 'queue-ring__core queue-ring__core--active' : 'queue-ring__core'}>
              {busy ? <LoaderCircle className="spin" size={34} /> : <Camera size={34} />}
            </div>
          </div>

          {queueStatus ? (
            <div className="queue-details">
              <div>
                <span>Position</span>
                <strong>#{queueStatus.position}</strong>
              </div>
              <div>
                <span>Estimated wait</span>
                <strong>{queueStatus.estimated_match_in}s</strong>
              </div>
            </div>
          ) : (
            <p className="muted-text">
              Camera and microphone access are checked before the search begins, so the
              room can open without an extra permission wall.
            </p>
          )}

          {error ? <div className="notice notice--error">{error}</div> : null}

          <div className="button-row">
            {!searching ? (
              <button
                className="button button--primary button--block"
                type="button"
                onClick={startMatchmaking}
                disabled={busy}
              >
                {busy ? 'Connecting to queue...' : 'Start searching'}
              </button>
            ) : (
              <button
                className="button button--danger button--block"
                type="button"
                onClick={cancelMatchmaking}
                disabled={busy}
              >
                <X size={16} />
                Cancel search
              </button>
            )}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Preferences</div>
              <h3>Directly mapped to `/api/v1/match/find`</h3>
            </div>
          </div>

          <div className="form-grid form-grid--two">
            <label className="field">
              <span>Gender preference</span>
              <select
                className="input"
                value={genderPreference}
                onChange={(event) => setGenderPreference(event.target.value)}
              >
                <option value="">Any</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="field">
              <span>Country preference</span>
              <input
                className="input"
                type="text"
                value={countryPreference}
                onChange={(event) => setCountryPreference(event.target.value)}
                placeholder="Uzbekistan"
              />
            </label>

            <label className="field">
              <span>Minimum age</span>
              <input
                className="input"
                type="number"
                min={13}
                value={ageMin}
                onChange={(event) => setAgeMin(event.target.value)}
                placeholder="18"
              />
            </label>

            <label className="field">
              <span>Maximum age</span>
              <input
                className="input"
                type="number"
                min={13}
                value={ageMax}
                onChange={(event) => setAgeMax(event.target.value)}
                placeholder="35"
              />
            </label>
          </div>
        </article>

        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Recent sessions</div>
              <h3>History already available from backend</h3>
            </div>
          </div>

          {loadingSessions ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={18} />
              <span>Loading session history...</span>
            </div>
          ) : recentSessions.length === 0 ? (
            <div className="empty-state">
              <Clock3 size={18} />
              <span>No previous sessions yet. Run one match to populate history.</span>
            </div>
          ) : (
            <div className="list-stack">
              {recentSessions.map((session) => {
                const label = session.opponent?.display_name || 'Hidden participant';
                const avatar = resolveMediaUrl(session.opponent?.avatar_url);

                return (
                  <button
                    key={session.session_id}
                    className="session-row"
                    type="button"
                    onClick={() => navigate('/app/history', { state: { sessionId: session.session_id } })}
                  >
                    <div className="session-row__identity">
                      {avatar ? (
                        <img className="session-row__avatar" src={avatar} alt={label} />
                      ) : (
                        <div className="session-row__fallback">{getInitials(label)}</div>
                      )}
                      <div>
                        <strong>{label}</strong>
                        <span>{formatRelativeTime(session.started_at)}</span>
                      </div>
                    </div>

                    <div className="session-row__meta">
                      <span>{session.status}</span>
                      <small>{formatDateTime(session.started_at)}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <section className="content-grid content-grid--three">
        <article className="surface surface--soft">
          <div className="eyebrow">Profile readiness</div>
          <h3>{getDisplayName(user ?? { display_name: null, username: null })}</h3>
          <p className="muted-text">
            Fill in age, country, and display name to make filter matching and history more
            useful for operators.
          </p>
        </article>

        <article className="surface surface--soft">
          <div className="eyebrow">Last online</div>
          <h3>{formatDateTime(user?.last_online)}</h3>
          <p className="muted-text">Pulled from `/api/v1/auth/me` on every authenticated restore.</p>
        </article>

        <article className="surface surface--soft">
          <div className="eyebrow">Moderation posture</div>
          <h3>{user?.reports_count ?? 0} reports</h3>
          <p className="muted-text">Settings page exposes your reports log and blocked list.</p>
        </article>
      </section>
    </div>
  );
}
