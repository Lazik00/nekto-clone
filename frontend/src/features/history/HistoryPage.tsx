import { Clock3, LoaderCircle, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { formatDateTime, formatRelativeTime, getInitials, resolveMediaUrl } from '../../lib/utils';
import { ApiError } from '../../services/api';
import type { ChatHistoryMessage, SessionSummary } from '../../types/api';

type HistoryLocationState = {
  sessionId?: string;
};

export function HistoryPage() {
  const { api, user } = useAuth();
  const location = useLocation();
  const routeState = (location.state as HistoryLocationState | null) ?? null;

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(routeState?.sessionId ?? null);
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await api.getChatSessions();
        if (cancelled) {
          return;
        }

        setSessions(response.sessions);
        const nextSelected = routeState?.sessionId ?? response.sessions[0]?.session_id ?? null;
        setSelectedSessionId(nextSelected);
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

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);

    void (async () => {
      try {
        const response = await api.getChatHistory(selectedSessionId);
        if (!cancelled) {
          setMessages(response.messages);
        }
      } catch (cause) {
        if (!cancelled && cause instanceof ApiError) {
          setError(cause.message);
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const filteredSessions = sessions.filter((session) => {
    const label = session.opponent?.display_name || '';
    return label.toLowerCase().includes(deferredQuery.trim().toLowerCase());
  });

  const activeSession = sessions.find((session) => session.session_id === selectedSessionId) ?? null;

  return (
    <div className="history-layout">
      <aside className="surface history-sidebar">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Session archive</div>
            <h3>Replay previous conversations</h3>
          </div>
        </div>

        <label className="field">
          <span>Search by opponent</span>
          <div className="search-field">
            <Search size={16} />
            <input
              className="input input--plain"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a display name"
            />
          </div>
        </label>

        {loading ? (
          <div className="empty-state">
            <LoaderCircle className="spin" size={18} />
            <span>Loading history...</span>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="empty-state">
            <Clock3 size={18} />
            <span>No sessions matched this query.</span>
          </div>
        ) : (
          <div className="list-stack">
            {filteredSessions.map((session) => {
              const avatar = resolveMediaUrl(session.opponent?.avatar_url);
              const label = session.opponent?.display_name || 'Hidden participant';

              return (
                <button
                  key={session.session_id}
                  className={session.session_id === selectedSessionId ? 'session-row session-row--active' : 'session-row'}
                  type="button"
                  onClick={() => setSelectedSessionId(session.session_id)}
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
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <section className="surface transcript-panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Transcript</div>
            <h3>{activeSession?.opponent?.display_name || 'Select a session'}</h3>
          </div>
          {activeSession ? <div className="status-pill">{formatDateTime(activeSession.started_at)}</div> : null}
        </div>

        {error ? <div className="notice notice--error">{error}</div> : null}

        {!activeSession ? (
          <div className="empty-state empty-state--large">
            <Clock3 size={20} />
            <span>Choose a session from the left to inspect stored messages.</span>
          </div>
        ) : messagesLoading ? (
          <div className="empty-state empty-state--large">
            <LoaderCircle className="spin" size={20} />
            <span>Fetching transcript...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state empty-state--large">
            <Clock3 size={20} />
            <span>No stored text messages for this session yet.</span>
          </div>
        ) : (
          <div className="transcript-list">
            {messages.map((message) => {
              const mine = message.sender_id === user?.id;
              return (
                <article
                  key={message.id}
                  className={mine ? 'transcript-bubble transcript-bubble--mine' : 'transcript-bubble'}
                >
                  <p>{message.content}</p>
                  <span>{formatDateTime(message.created_at)}</span>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
