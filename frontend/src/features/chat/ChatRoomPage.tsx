import {
  Ban,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  ShieldAlert,
  SkipForward,
  Video,
  VideoOff,
} from 'lucide-react';
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import {
  formatDateTime,
  getDisplayName,
  getInitials,
  resolveMediaUrl,
} from '../../lib/utils';
import { ApiError, getWebSocketUrl } from '../../services/api';
import type { MatchUser, ReportReason } from '../../types/api';

type RoomPeer = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  age?: number | null;
  country?: string | null;
  bio?: string | null;
};

type LiveMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type RouteState = {
  matchUser?: MatchUser;
};

const reportReasons: Array<{ label: string; value: ReportReason }> = [
  { label: 'Harassment', value: 'harassment' },
  { label: 'Hate speech', value: 'hate_speech' },
  { label: 'Explicit content', value: 'explicit_content' },
  { label: 'Spam', value: 'spam' },
  { label: 'Inappropriate behavior', value: 'inappropriate_behavior' },
  { label: 'Other', value: 'other' },
];

function normalizeMatchUser(matchUser: MatchUser): RoomPeer {
  return {
    id: matchUser.user_id,
    display_name: matchUser.display_name,
    avatar_url: matchUser.avatar_url,
    age: matchUser.age,
    country: matchUser.country,
    bio: matchUser.bio,
  };
}

export function ChatRoomPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state as RouteState | null) ?? null;

  const { accessToken, api, user } = useAuth();

  const [peer, setPeer] = useState<RoomPeer | null>(
    routeState?.matchUser ? normalizeMatchUser(routeState.matchUser) : null,
  );
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [composer, setComposer] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'waiting' | 'connected' | 'disconnected'
  >('connecting');
  const [role, setRole] = useState<'caller' | 'callee' | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('harassment');
  const [reportDescription, setReportDescription] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const roleRef = useRef<'caller' | 'callee' | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const remoteDescriptionReadyRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const endedRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const appendMessage = (incoming: LiveMessage) => {
    setMessages((current) => {
      if (current.some((message) => message.id === incoming.id)) {
        return current;
      }

      return [...current, incoming];
    });
  };

  const sendSocketPayload = (payload: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  };

  const flushPendingCandidates = async (connection: RTCPeerConnection) => {
    for (const candidate of pendingCandidatesRef.current) {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    pendingCandidatesRef.current = [];
  };

  const createAndSendOffer = async (connection: RTCPeerConnection) => {
    const offer = await connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await connection.setLocalDescription(offer);
    sendSocketPayload({
      type: 'offer',
      data: offer,
    });
  };

  const handleWebRtcSignal = useEffectEvent(async (signalType: string, data: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    const connection = peerConnectionRef.current;
    if (!connection) {
      return;
    }

    if (signalType === 'offer') {
      await connection.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
      remoteDescriptionReadyRef.current = true;
      await flushPendingCandidates(connection);

      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      sendSocketPayload({
        type: 'answer',
        data: answer,
      });
      return;
    }

    if (signalType === 'answer') {
      await connection.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
      remoteDescriptionReadyRef.current = true;
      await flushPendingCandidates(connection);
      return;
    }

    if (signalType === 'candidate') {
      const candidate = data as RTCIceCandidateInit;

      if (!remoteDescriptionReadyRef.current) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }

      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  const initializePeerConnection = useEffectEvent((rtcConfig: {
    stun_server?: string;
    turn_server?: string;
    turn_username?: string;
    turn_password?: string;
  }) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const iceServers: RTCIceServer[] = [];
    if (rtcConfig.stun_server) {
      iceServers.push({ urls: rtcConfig.stun_server });
    }

    if (rtcConfig.turn_server) {
      iceServers.push({
        urls: rtcConfig.turn_server,
        username: rtcConfig.turn_username,
        credential: rtcConfig.turn_password,
      });
    }

    const connection = new RTCPeerConnection({ iceServers });

    localStreamRef.current?.getTracks().forEach((track) => {
      if (localStreamRef.current) {
        connection.addTrack(track, localStreamRef.current);
      }
    });

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      setConnectionStatus('connected');
    };

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSocketPayload({
          type: 'candidate',
          data: event.candidate,
        });
      }
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') {
        setConnectionStatus('connected');
      }

      if (
        connection.connectionState === 'disconnected' ||
        connection.connectionState === 'failed' ||
        connection.connectionState === 'closed'
      ) {
        setConnectionStatus('disconnected');
      }
    };

    remoteDescriptionReadyRef.current = false;
    pendingCandidatesRef.current = [];
    peerConnectionRef.current = connection;
  });

  const handleSocketMessage = useEffectEvent(async (event: MessageEvent<string>) => {
    const payload = JSON.parse(event.data) as {
      type: string;
      role?: 'caller' | 'callee';
      signal_type?: string;
      data?: RTCSessionDescriptionInit | RTCIceCandidateInit;
      sender_id?: string;
      content?: string;
      id?: string;
      timestamp?: string;
      reason?: string;
      stun_server?: string;
      turn_server?: string;
      turn_username?: string;
      turn_password?: string;
    };

    if (payload.type === 'role' && payload.role) {
      roleRef.current = payload.role;
      setRole(payload.role);
      return;
    }

    if (payload.type === 'waiting_for_peer') {
      setConnectionStatus('waiting');
      return;
    }

    if (payload.type === 'stun_turn') {
      initializePeerConnection(payload);
      return;
    }

    if (payload.type === 'user_connected') {
      if (
        roleRef.current === 'caller' &&
        peerConnectionRef.current &&
        peerConnectionRef.current.signalingState === 'stable'
      ) {
        await createAndSendOffer(peerConnectionRef.current);
      }
      return;
    }

    if (payload.type === 'chat_message' && payload.content && payload.sender_id) {
      const senderId = payload.sender_id;
      const content = payload.content;

      startTransition(() => {
        appendMessage({
          id: payload.id || `${senderId}-${payload.timestamp || Date.now()}`,
          sender_id: senderId,
          content,
          created_at: payload.timestamp || new Date().toISOString(),
        });
      });
      return;
    }

    if (payload.type === 'webrtc_signal' && payload.signal_type && payload.data) {
      await handleWebRtcSignal(payload.signal_type, payload.data);
      return;
    }

    if (payload.type === 'user_disconnected' || payload.type === 'session_ended') {
      if (!endedRef.current) {
        endedRef.current = true;
        setNotice(payload.reason === 'ended' ? 'Session ended.' : 'The other user disconnected.');
        navigate('/app', { replace: true });
      }
    }
  });

  const cleanupRoom = () => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!sessionId || !accessToken || !user) {
      return undefined;
    }

    let disposed = false;

    const bootstrap = async () => {
      setLoadingRoom(true);
      setError('');
      setNotice('');

      try {
        if (!peer) {
          const sessionsResponse = await api.getChatSessions();
          const activeSession = sessionsResponse.sessions.find((session) => session.session_id === sessionId);
          if (activeSession?.opponent) {
            setPeer({
              id: activeSession.opponent.id,
              display_name: activeSession.opponent.display_name,
              avatar_url: activeSession.opponent.avatar_url,
            });
          }
        }

        const history = await api.getChatHistory(sessionId);
        if (!disposed) {
          setMessages(
            history.messages.map((message) => ({
              id: message.id,
              sender_id: message.sender_id,
              content: message.content,
              created_at: message.created_at,
            })),
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const socket = new WebSocket(getWebSocketUrl(sessionId, accessToken));
        wsRef.current = socket;

        socket.onopen = () => {
          setConnectionStatus('connecting');
        };

        socket.onmessage = (event) => {
          void handleSocketMessage(event);
        };

        socket.onerror = () => {
          setConnectionStatus('disconnected');
          setError('WebSocket connection failed.');
        };

        socket.onclose = () => {
          if (!endedRef.current) {
            setConnectionStatus('disconnected');
          }
        };
      } catch (cause) {
        if (cause instanceof ApiError) {
          setError(cause.message);
        } else if (cause instanceof Error) {
          setError(cause.message);
        } else {
          setError('Unable to start the chat room.');
        }
      } finally {
        if (!disposed) {
          setLoadingRoom(false);
        }
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      cleanupRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, accessToken, user?.id]);

  if (!user) {
    return null;
  }

  const peerName = peer ? getDisplayName({ display_name: peer.display_name }) : 'Matched participant';
  const peerAvatar = resolveMediaUrl(peer?.avatar_url);

  const leaveRoom = (reason: string) => {
    endedRef.current = true;
    sendSocketPayload({
      type: 'end_session',
      reason,
    });
    cleanupRoom();
    navigate('/app', { replace: true });
  };

  const sendMessage = () => {
    const trimmed = composer.trim();
    if (!trimmed) {
      return;
    }

    const delivered = sendSocketPayload({
      type: 'chat_message',
      content: trimmed,
    });

    if (delivered) {
      setComposer('');
    }
  };

  const toggleAudio = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    setAudioEnabled(track.enabled);
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) {
      return;
    }

    track.enabled = !track.enabled;
    setVideoEnabled(track.enabled);
  };

  const submitReport = async () => {
    if (!peer) {
      return;
    }

    setActionBusy(true);
    setError('');

    try {
      await api.createReport({
        reported_user_id: peer.id,
        reason: reportReason,
        description: reportDescription.trim() || undefined,
        chat_session_id: sessionId,
      });
      setReportOpen(false);
      setReportDescription('');
      setNotice('Report submitted successfully.');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const blockPeer = async () => {
    if (!peer) {
      return;
    }

    setActionBusy(true);
    setError('');

    try {
      await api.blockUser(peer.id);
      leaveRoom('user_blocked');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      }
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="chat-layout">
      <section className="surface chat-stage">
        <header className="chat-stage__header">
          <div className="session-row__identity">
            {peerAvatar ? (
              <img className="session-row__avatar" src={peerAvatar} alt={peerName} />
            ) : (
              <div className="session-row__fallback">{getInitials(peerName)}</div>
            )}
            <div>
              <strong>{peerName}</strong>
              <span>
                {connectionStatus === 'connected'
                  ? 'Live'
                  : connectionStatus === 'waiting'
                    ? 'Waiting for peer'
                    : 'Connecting'}
                {role ? ` · ${role}` : ''}
              </span>
            </div>
          </div>

          <div className="button-row">
            <button className="button button--ghost" type="button" onClick={() => setReportOpen((current) => !current)}>
              <ShieldAlert size={16} />
              Report
            </button>
            <button className="button button--ghost" type="button" onClick={blockPeer} disabled={actionBusy}>
              <Ban size={16} />
              Block
            </button>
          </div>
        </header>

        {error ? <div className="notice notice--error">{error}</div> : null}
        {notice ? <div className="notice notice--success">{notice}</div> : null}

        {reportOpen ? (
          <div className="surface surface--soft report-sheet">
            <div className="form-grid">
              <label className="field">
                <span>Reason</span>
                <select
                  className="input"
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value as ReportReason)}
                >
                  {reportReasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--full">
                <span>Description</span>
                <textarea
                  className="textarea"
                  rows={3}
                  maxLength={1000}
                  value={reportDescription}
                  onChange={(event) => setReportDescription(event.target.value)}
                  placeholder="Add context for the moderation team."
                />
              </label>

              <div className="button-row">
                <button className="button button--primary" type="button" onClick={submitReport} disabled={actionBusy}>
                  Submit report
                </button>
                <button className="button button--ghost" type="button" onClick={() => setReportOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="video-stage">
          <div className="video-panel">
            {loadingRoom ? (
              <div className="video-placeholder">
                <LoaderCircle className="spin" size={24} />
                <span>Preparing local camera and room session...</span>
              </div>
            ) : null}

            <video className="video-element video-element--remote" ref={remoteVideoRef} autoPlay playsInline />
            {!loadingRoom && connectionStatus !== 'connected' ? (
              <div className="video-overlay">
                <h3>{connectionStatus === 'waiting' ? 'Waiting for other user' : 'Negotiating call'}</h3>
                <p>{peer?.bio || 'The remote stream will appear here as soon as signaling completes.'}</p>
              </div>
            ) : null}

            <div className="video-tile">
              <video
                className="video-element video-element--local"
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              <div className="video-tile__label">You</div>
            </div>
          </div>

          <aside className={showChat ? 'chat-sidebar' : 'chat-sidebar chat-sidebar--hidden'}>
            <div className="chat-sidebar__header">
              <div>
                <div className="eyebrow">Text channel</div>
                <h3>Session messages</h3>
              </div>
              <button className="button button--ghost" type="button" onClick={() => setShowChat((current) => !current)}>
                <MessageSquare size={16} />
                {showChat ? 'Hide chat' : 'Show chat'}
              </button>
            </div>

            <div className="chat-log">
              {messages.map((message) => {
                const mine = message.sender_id === user.id;
                return (
                  <article key={message.id} className={mine ? 'chat-bubble chat-bubble--mine' : 'chat-bubble'}>
                    <p>{message.content}</p>
                    <span>{formatDateTime(message.created_at)}</span>
                  </article>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer">
              <textarea
                className="textarea"
                rows={3}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Write a message"
              />
              <button className="button button--primary" type="button" onClick={sendMessage}>
                <Send size={16} />
                Send
              </button>
            </div>
          </aside>
        </div>

        <footer className="chat-controls">
          <button className="button button--ghost" type="button" onClick={toggleAudio}>
            {audioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
            {audioEnabled ? 'Mute' : 'Unmute'}
          </button>
          <button className="button button--ghost" type="button" onClick={toggleVideo}>
            {videoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
            {videoEnabled ? 'Camera off' : 'Camera on'}
          </button>
          <button className="button button--ghost" type="button" onClick={() => setShowChat((current) => !current)}>
            <MessageSquare size={16} />
            {showChat ? 'Hide chat' : 'Open chat'}
          </button>
          <button className="button button--secondary" type="button" onClick={() => leaveRoom('skip')}>
            <SkipForward size={16} />
            Next user
          </button>
          <button className="button button--danger" type="button" onClick={() => leaveRoom('user_left')}>
            <PhoneOff size={16} />
            Leave room
          </button>
        </footer>
      </section>
    </div>
  );
}
