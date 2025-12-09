import { useState, useEffect, useRef } from 'react';
import {
  Video as VideoIcon,
  VideoOff,
  Mic,
  MicOff,
  MessageSquare,
  SkipForward,
  X,
  Send,
  AlertTriangle,
  Ban,
  ChevronDown,
} from 'lucide-react';
import { User } from '../App';
import { getApiUrl, getWsUrl } from '../config/api';

type ChatRoomProps = {
  sessionId: string;
  accessToken: string;
  currentUser: User;
  matchUser: User;
  onEndChat: () => void;
  onBack: () => void;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  timestamp: string;
};

export function ChatRoom({
  sessionId,
  accessToken,
  currentUser,
  matchUser,
  onEndChat,
  onBack,
}: ChatRoomProps) {
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  // Caller / Callee role (from backend)
  const [role, setRole] = useState<'caller' | 'callee' | null>(null);
  const roleRef = useRef<'caller' | 'callee' | null>(null);

  // Core refs
  const wsRef = useRef<WebSocket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // WebRTC race-condition fixes
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Dynamic quality monitor timer
  const qualityMonitorRef = useRef<number | null>(null);

  useEffect(() => {
    initializeMediaAndWebSocket();

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, accessToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initializeMediaAndWebSocket = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Your browser does not support camera/microphone access. Please use a modern browser like Chrome, Firefox, or Edge.',
        );
      }

      // 1) Get camera + mic (adaptive, 320–1080, 30–60 fps)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { min: 320, ideal: 1280, max: 1920 },
          height: { min: 240, ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // 2) Open WebSocket (token already inside getWsUrl)
      const wsUrl = getWsUrl(sessionId);
      console.log('WS URL:', wsUrl);
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setConnectionStatus('connected');
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[WS MESSAGE]', data);
        void handleWebSocketMessage(data);
      };

      websocket.onerror = (error: any) => {
        console.error('❌ WebSocket error:', error);

        const target = error?.target as WebSocket | undefined;
        console.error('WebSocket ReadyState:', target?.readyState);

        let errorMessage = 'WebSocket connection failed. ';

        if (error.type === 'error') {
          if (window.location.protocol === 'https:') {
            errorMessage +=
              'Possible SSL/Certificate issue (self-signed). Try opening the WebSocket URL directly and accept the certificate.';
          } else {
            errorMessage +=
              'Check your internet connection and ensure the backend is running.';
          }
        }

        console.error(errorMessage);
        setConnectionStatus('disconnected');
      };

      websocket.onclose = () => {
        console.log('WebSocket closed');
        setConnectionStatus('disconnected');
      };
    } catch (error: any) {
      console.error('Failed to initialize media/websocket:', error);

      let errorMessage = 'Failed to access camera/microphone. ';

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage +=
          'Permission denied. Please allow camera and microphone access in your browser and refresh the page.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += 'No camera or microphone found. Connect a device and try again.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage += 'Camera or microphone is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage +=
          'Device does not match required constraints. Try a different camera/mic.';
      } else if (error.name === 'SecurityError') {
        errorMessage += 'Access blocked by browser security. Use HTTPS or localhost.';
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please check your permissions and try again.';
      }

      alert(errorMessage);
      onBack();
    }
  };

  const handleWebSocketMessage = async (data: any) => {
    switch (data.type) {
      // Backend → role (caller / callee)
      case 'role': {
        if (data.role === 'caller' || data.role === 'callee') {
          roleRef.current = data.role;
          setRole(data.role);
          console.log('[WS] Role set:', data.role);
        } else {
          console.warn('[WS] Unknown role value:', data.role);
        }
        break;
      }

      case 'waiting_for_peer':
        console.log('[RTC] Waiting for peer to connect...');
        break;

      // Backend sends STUN/TURN here
      case 'stun_turn':
        console.log('[WS] STUN/TURN config received', data);
        initializePeerConnection(data);
        break;

      case 'chat_message':
        setMessages((prev) => [
          ...prev,
          {
            id: (data.id ?? Date.now()).toString(),
            sender_id: data.sender_id,
            content: data.content,
            timestamp: data.timestamp ?? new Date().toISOString(),
          },
        ]);
        break;

      // Backend → client WebRTC signaling wrapper
      case 'webrtc_signal':
        await handleWebRTCSignal(data);
        break;

      case 'user_connected': {
        console.log('[WS] User connected:', data.user_id);

        // Caller tarafda: opponent ulansa, offer yuboramiz
        if (roleRef.current === 'caller' && peerConnectionRef.current) {
          console.log('[RTC] Peer joined, sending initial offer...');
          await createAndSendOffer(peerConnectionRef.current);
        }
        break;
      }

      case 'user_disconnected':
        console.log('[WS] User disconnected:', data.user_id);
        handleUserDisconnected();
        break;

      case 'session_ended':
        console.log('[WS] Session ended:', data.reason);
        handleSessionEnded();
        break;

      default:
        console.log('[WS] Unknown message type:', data.type, data);
    }
  };

  const initializePeerConnection = (stunTurnData: any) => {
    // Reset WebRTC flags
    remoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];

    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: stunTurnData.stun_server },
        {
          urls: stunTurnData.turn_server,
          username: stunTurnData.turn_username,
          credential: stunTurnData.turn_password,
        },
      ],
    };

    console.log('[RTC] Creating RTCPeerConnection with config:', configuration);
    const pc = new RTCPeerConnection(configuration);

    // Local tracks
    localStreamRef.current?.getTracks().forEach((track) => {
      if (localStreamRef.current) {
        pc.addTrack(track, localStreamRef.current);
      }
    });

    // Remote video
    pc.ontrack = (event) => {
      console.log('[RTC] ontrack streams:', event.streams);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // ICE candidate → send to other peer via WS
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = wsRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          console.log('[RTC] Sending ICE candidate');
          socket.send(
            JSON.stringify({
              type: 'candidate',
              data: event.candidate,
            }),
          );
        } else {
          console.warn('[RTC] ICE candidate, but WebSocket not ready');
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[RTC] connectionState =', pc.connectionState);
    };

    peerConnectionRef.current = pc;

    // Dynamic quality monitor
    startDynamicQualityMonitor(pc);

    // Offer bu yerda YARATILMAYDI.
    // Caller uchun offer faqat "user_connected" eventida yuboriladi.
    console.log('[RTC] PeerConnection ready, waiting for peer to join...');
  };

  const createAndSendOffer = async (pc: RTCPeerConnection) => {
    try {
      console.log('[RTC] Creating offer...');

      // SIMULCAST (3 ta qatlam: high/mid/low)
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        try {
          const params = sender.getParameters();
          params.encodings = [
            {
              rid: 'high',
              maxBitrate: 2500000, // ~2.5 Mbps
              scaleResolutionDownBy: 1.0, // 1080p
            },
            {
              rid: 'mid',
              maxBitrate: 1000000, // ~1 Mbps
              scaleResolutionDownBy: 1.5, // ~720p
            },
            {
              rid: 'low',
              maxBitrate: 300000, // ~300 kbps
              scaleResolutionDownBy: 3.0, // ~360p
            },
          ];
          await sender.setParameters(params);
          console.log('[RTC] Simulcast enabled.');
        } catch (err) {
          console.warn('[RTC] Simulcast not supported or setParameters failed:', err);
        }
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.setLocalDescription(offer);

      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('[RTC] Sending offer via WS');
        socket.send(
          JSON.stringify({
            type: 'offer',
            data: offer,
          }),
        );
      } else {
        console.warn('[RTC] Cannot send offer, WS not open');
      }
    } catch (error) {
      console.error('Failed to create offer:', error);
    }
  };

  const startDynamicQualityMonitor = (pc: RTCPeerConnection) => {
    // Avval eski timer bo‘lsa tozalaymiz
    if (qualityMonitorRef.current !== null) {
      window.clearInterval(qualityMonitorRef.current);
      qualityMonitorRef.current = null;
    }

    // Har 3 sekundda stats tekshirish
    const id = window.setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let outbound: any = null;

        stats.forEach((report) => {
          // Chrome: type "outbound-rtp" & kind "video"
          if (report.type === 'outbound-rtp' && (report as any).kind === 'video') {
            outbound = report;
          }
        });

        if (!outbound) return;

        const bytesSent = outbound.bytesSent as number | undefined;
        const packetsSent = outbound.packetsSent as number | undefined;
        const packetsLost = (outbound.packetsLost as number | undefined) ?? 0;
        const fps = (outbound.framesPerSecond as number | undefined) ?? 0;

        console.log('📉 Bitrate stats:', {
          bytesSent,
          packetsSent,
          packetsLost,
          fps,
        });

        const senders = pc.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === 'video');

        if (!videoSender) return;

        const params = videoSender.getParameters();
        if (!params.encodings) return;

        // Hech bo‘lmasa eng katta qatlam bilan ishlaymiz
        const [high, mid, low] = params.encodings;

        // Internet yomonlashganda → bitrate qisqartiramiz
        if (packetsLost > 20 || fps < 10) {
          if (high) high.maxBitrate = 800_000;
          if (mid) mid.maxBitrate = 400_000;
          if (low) low.maxBitrate = 150_000;
          console.log('⚠️ Internet yomon → bitrate pasaytirildi');
        }

        // Internet yaxshi → bitrate qayta ko‘tariladi
        if (packetsLost < 5 && fps > 25) {
          if (high) high.maxBitrate = 2_500_000;
          if (mid) mid.maxBitrate = 1_000_000;
          if (low) low.maxBitrate = 300_000;
          console.log('🚀 Internet yaxshi → bitrate ko‘tarildi');
        }

        await videoSender.setParameters(params);
      } catch (err) {
        console.error('Dynamic quality monitor error:', err);
      }
    }, 3000);

    qualityMonitorRef.current = id;
  };

  const flushPendingCandidates = async (pc: RTCPeerConnection) => {
    if (!pendingCandidatesRef.current.length) return;

    console.log(
      `[RTC] Flushing ${pendingCandidatesRef.current.length} pending ICE candidates`,
    );

    for (const candidateInit of pendingCandidatesRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch (err) {
        console.error('Failed to add pending ICE candidate:', err);
      }
    }
    pendingCandidatesRef.current = [];
  };

  const handleWebRTCSignal = async (data: any) => {
    const pc = peerConnectionRef.current;
    if (!pc) {
      console.warn('[RTC] No peerConnectionRef yet for signal:', data);
      return;
    }

    try {
      switch (data.signal_type) {
        case 'offer': {
          console.log('[RTC] Received offer');
          const remoteDesc = new RTCSessionDescription(data.data);
          await pc.setRemoteDescription(remoteDesc);
          remoteDescriptionSetRef.current = true;

          await flushPendingCandidates(pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          const socket = wsRef.current;
          if (socket && socket.readyState === WebSocket.OPEN) {
            console.log('[RTC] Sending answer');
            socket.send(
              JSON.stringify({
                type: 'answer',
                data: answer,
              }),
            );
          } else {
            console.warn('[RTC] Cannot send answer, WS not open');
          }
          break;
        }

        case 'answer': {
          console.log('[RTC] Received answer');
          const remoteDesc = new RTCSessionDescription(data.data);
          await pc.setRemoteDescription(remoteDesc);
          remoteDescriptionSetRef.current = true;

          await flushPendingCandidates(pc);
          break;
        }

        case 'candidate': {
          console.log('[RTC] Received ICE candidate');
          const candidateInit = data.data as RTCIceCandidateInit;

          if (!remoteDescriptionSetRef.current) {
            console.log('[RTC] RemoteDescription not set yet, queueing candidate');
            pendingCandidatesRef.current.push(candidateInit);
          } else {
            await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
          }
          break;
        }

        default:
          console.log('[RTC] Unknown webrtc_signal type:', data.signal_type);
      }
    } catch (error) {
      console.error('Failed to handle WebRTC signal:', error);
    }
  };

  const sendMessage = () => {
    const socket = wsRef.current;
    if (!inputMessage.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;

    // Xabarni faqat server orqali tarqatamiz
    try {
      socket.send(
        JSON.stringify({
          type: 'chat_message',
          content: inputMessage,
        }),
      );
      setInputMessage('');
    } catch (e) {
      console.error('Failed to send message via WS:', e);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const handleNext = () => {
    endSession('user_left');
    onEndChat();
  };

  const handleEndSession = () => {
    endSession('user_left');
    onBack();
  };

  const endSession = (reason: string) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({
            type: 'end_session',
            reason,
          }),
        );
      } catch (e) {
        console.error('Failed to send end_session:', e);
      }
    }
    cleanup();
  };

  const handleUserDisconnected = () => {
    alert('The other user has disconnected.');
    cleanup();
    onEndChat();
  };

  const handleSessionEnded = () => {
    cleanup();
    onEndChat();
  };

  const handleReport = async () => {
    if (!reportReason) return;

    try {
      await fetch(getApiUrl('/api/v1/create'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reported_user_id: matchUser.id,
          reason: reportReason,
          description: reportDescription,
          chat_session_id: sessionId,
        }),
      });

      alert('Report submitted successfully');
      setShowReportMenu(false);
      setReportReason('');
      setReportDescription('');
    } catch (error) {
      console.error('Failed to submit report:', error);
      alert('Failed to submit report');
    }
  };

  const handleBlock = async () => {
    try {
      await fetch(getApiUrl(`/match/block/${matchUser.id}`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      alert('User blocked successfully');
      endSession('user_blocked');
      onEndChat();
    } catch (error) {
      console.error('Failed to block user:', error);
      alert('Failed to block user');
    }
  };
  function getAspectMode() {
  const ratio = window.innerWidth / window.innerHeight;
  return ratio < 1 ? "tall" : "wide";
}

const [aspectMode, setAspectMode] = useState(getAspectMode());

useEffect(() => {
  const handler = () => setAspectMode(getAspectMode());
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
}, []);

  const cleanup = () => {
    console.log('[CLEANUP] Closing WS, PC, and media tracks');

    if (qualityMonitorRef.current !== null) {
      window.clearInterval(qualityMonitorRef.current);
      qualityMonitorRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {
        // ignore
      }
      peerConnectionRef.current = null;
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    remoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
    setConnectionStatus('disconnected');
  };

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 px-6 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white">
              {matchUser.display_name?.[0] || matchUser.username[0]}
            </div>
            <div>
              <div className="text-white">
                {matchUser.display_name || matchUser.username}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                {connectionStatus === 'connected' ? 'Connected' : 'Connecting...'}
                {role && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-700 text-[10px] uppercase">
                    {role}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReportMenu(!showReportMenu)}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Report
          </button>
          <button
            onClick={handleBlock}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition flex items-center gap-2"
          >
            <Ban className="w-4 h-4" />
            Block
          </button>
        </div>
      </header>

      {/* Report Menu */}
      {showReportMenu && (
        <div className="bg-yellow-900/20 border-b border-yellow-800 px-6 py-4">
          <div className="max-w-2xl">
            <h3 className="text-white mb-3">Report User</h3>
            <div className="space-y-3">
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 text-white border border-gray-700 rounded-lg outline-none focus:border-yellow-500"
              >
                <option value="">Select reason</option>
                <option value="harassment">Harassment</option>
                <option value="inappropriate_content">Inappropriate Content</option>
                <option value="spam">Spam</option>
                <option value="other">Other</option>
              </select>
              <textarea
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="Additional details (optional)"
                className="w-full px-3 py-2 bg-gray-800 text-white border border-gray-700 rounded-lg outline-none focus:border-yellow-500 resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReport}
                  disabled={!reportReason}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Report
                </button>
                <button
                  onClick={() => setShowReportMenu(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Area */}
<div
  className="flex-grow relative overflow-hidden"
  style={{ height: "calc(80vh - 30px)" }}
>

  {aspectMode === "wide" ? (
    /* === 16:9 — YONMA-YON === */
    <div className="flex w-full h-full">

      {/* Remote */}
      <div className="w-full h-full bg-black">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      </div>

      {/* Local */}
      <div className="w-full h-1/2 bg-black absolute top-4 right-4 border-4 border-gray-800 rounded-lg overflow-hidden shadow-lg" style={{ width: '30%', height: '30%' }}>
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover mirror"
        />
      </div>

    </div>
  ) : (
    /* === 9:16 — VERTIKAL === */
    <div className="flex flex-col w-full h-full">

  {/* REMOTE — 60% HEIGHT */}
  <div className="h-1/2 w-full bg-black">
    <video
      ref={remoteVideoRef}
      autoPlay
      playsInline
      className="w-1/2 h-full object-cover"
    />
  </div>

  {/* LOCAL — 40% HEIGHT */}
  <div className="h-40 w-full bg-black">
    <video
      ref={localVideoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover mirror"
    />
  </div>

</div>
  )}

        {/* Controls */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <button
            onClick={toggleVideo}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition shadow-lg ${
              videoEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {videoEnabled ? (
              <VideoIcon className="w-6 h-6" />
            ) : (
              <VideoOff className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={toggleAudio}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition shadow-lg ${
              audioEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {audioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>

          <button
            onClick={() => setShowChat(!showChat)}
            className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition shadow-lg"
          >
            <MessageSquare className="w-6 h-6" />
          </button>

          <button
            onClick={handleNext}
            className="w-14 h-14 rounded-full bg-green-600 hover:bg-green-700 text-white flex items-center justify-center transition shadow-lg"
          >
            <SkipForward className="w-6 h-6" />
          </button>

          <button
            onClick={handleEndSession}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition shadow-lg"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-white">Chat</h3>
            <button
              onClick={() => setShowChat(false)}
              className="text-gray-400 hover:text-white"
            >
              <ChevronDown className="w-5 h-5 rotate-90" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.sender_id === currentUser.id ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                    msg.sender_id === currentUser.id
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-white'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-full outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={sendMessage}
                className="w-10 h-10 bg-purple-600 hover:bg-purple-700 text-white rounded-full flex items-center justify-center transition"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
}
