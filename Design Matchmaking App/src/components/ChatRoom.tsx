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
  ChevronDown
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
  onBack
}: ChatRoomProps) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initializeMediaAndWebSocket();

    return () => {
      cleanup();
    };
  }, [sessionId, accessToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initializeMediaAndWebSocket = async () => {
    try {
      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera/microphone access. Please use a modern browser like Chrome, Firefox, or Edge.');
      }

      // Request permissions and get local media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Connect to WebSocket
      const wsUrl = getWsUrl(`/api/v1/chat/ws/${sessionId}?token=${accessToken}`);
      console.log('Attempting WebSocket connection to:', wsUrl.replace(accessToken, 'TOKEN_HIDDEN'));

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setConnectionStatus('connected');
      };

      websocket.onmessage = (event) => {
        handleWebSocketMessage(JSON.parse(event.data));
      };

      websocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        console.error('Error type:', error.type);
        console.error('Error target:', (error.target as WebSocket)?.readyState);

        // Log helpful debugging information
        const ws = error.target as WebSocket;
        console.error('WebSocket ReadyState:', {
          'CONNECTING': ws?.readyState === 0,
          'OPEN': ws?.readyState === 1,
          'CLOSING': ws?.readyState === 2,
          'CLOSED': ws?.readyState === 3,
          'Current': ws?.readyState
        });

        let errorMessage = 'WebSocket connection failed. ';

        // Check for common issues
        if (error.type === 'error') {
          if (window.location.protocol === 'https:') {
            errorMessage += 'SSL/Certificate issue detected. This is usually due to self-signed certificates. ';
            errorMessage += 'Try accepting the certificate warning in your browser by visiting the WebSocket URL directly.';
          } else {
            errorMessage += 'Check your connection and ensure the backend is running.';
          }
        }

        console.error(errorMessage);
        setConnectionStatus('disconnected');
      };

      websocket.onclose = () => {
        console.log('WebSocket closed');
        setConnectionStatus('disconnected');
      };

      setWs(websocket);
    } catch (error: any) {
      console.error('Failed to initialize media/websocket:', error);

      // Provide specific error messages based on the error type
      let errorMessage = 'Failed to access camera/microphone. ';

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += 'Permission denied. Please allow camera and microphone access in your browser settings and refresh the page.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += 'No camera or microphone found. Please connect a camera/microphone and try again.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage += 'Camera or microphone is already in use by another application. Please close other applications and try again.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage += 'Camera/microphone does not meet the required specifications. Please try with different devices.';
      } else if (error.name === 'SecurityError') {
        errorMessage += 'Access blocked due to security restrictions. Please ensure you are using HTTPS or localhost.';
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please check your permissions and try again.';
      }

      alert(errorMessage);
      onBack(); // Return to previous screen if media access fails
    }
  };

  const handleWebSocketMessage = async (data: any) => {
    switch (data.type) {
      case 'stun_turn_servers':
        initializePeerConnection(data);
        break;
      
      case 'chat_message':
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender_id: data.sender_id,
          content: data.content,
          timestamp: data.timestamp
        }]);
        break;
      
      case 'webrtc_signal':
        handleWebRTCSignal(data);
        break;
      
      case 'user_connected':
        console.log('User connected:', data.user_id);
        break;
      
      case 'user_disconnected':
        console.log('User disconnected:', data.user_id);
        handleUserDisconnected();
        break;
      
      case 'session_ended':
        console.log('Session ended:', data.reason);
        handleSessionEnded();
        break;
    }
  };

  const initializePeerConnection = (stunTurnData: any) => {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: stunTurnData.stun_server },
        {
          urls: stunTurnData.turn_server,
          username: stunTurnData.turn_username,
          credential: stunTurnData.turn_password
        }
      ]
    };

    const pc = new RTCPeerConnection(configuration);

    // Add local stream tracks
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Handle incoming tracks
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && ws) {
        ws.send(JSON.stringify({
          type: 'webrtc_signal',
          signal_type: 'candidate',
          data: event.candidate
        }));
      }
    };

    peerConnectionRef.current = pc;

    // Create and send offer
    createAndSendOffer(pc);
  };

  const createAndSendOffer = async (pc: RTCPeerConnection) => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (ws) {
        ws.send(JSON.stringify({
          type: 'webrtc_signal',
          signal_type: 'offer',
          data: offer
        }));
      }
    } catch (error) {
      console.error('Failed to create offer:', error);
    }
  };

  const handleWebRTCSignal = async (data: any) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    try {
      switch (data.signal_type) {
        case 'offer':
          await pc.setRemoteDescription(new RTCSessionDescription(data.data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          if (ws) {
            ws.send(JSON.stringify({
              type: 'webrtc_signal',
              signal_type: 'answer',
              data: answer
            }));
          }
          break;
        
        case 'answer':
          await pc.setRemoteDescription(new RTCSessionDescription(data.data));
          break;
        
        case 'candidate':
          await pc.addIceCandidate(new RTCIceCandidate(data.data));
          break;
      }
    } catch (error) {
      console.error('Failed to handle WebRTC signal:', error);
    }
  };

  const sendMessage = () => {
    if (inputMessage.trim() && ws) {
      ws.send(JSON.stringify({
        type: 'chat_message',
        content: inputMessage
      }));

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender_id: currentUser.id,
        content: inputMessage,
        timestamp: new Date().toISOString()
      }]);

      setInputMessage('');
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
    if (ws) {
      ws.send(JSON.stringify({
        type: 'end_session',
        reason
      }));
    }
    cleanup();
  };

  const handleUserDisconnected = () => {
    alert('The other user has disconnected.');
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
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reported_user_id: matchUser.id,
          reason: reportReason,
          description: reportDescription,
          chat_session_id: sessionId
        })
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
          'Authorization': `Bearer ${accessToken}`
        }
      });

      alert('User blocked successfully');
      endSession('user_blocked');
      onEndChat();
    } catch (error) {
      console.error('Failed to block user:', error);
      alert('Failed to block user');
    }
  };

  const cleanup = () => {
    // Close WebSocket
    if (ws) {
      ws.close();
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // Stop local media tracks
    localStreamRef.current?.getTracks().forEach(track => track.stop());
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
              <div className="text-white">{matchUser.display_name || matchUser.username}</div>
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                {connectionStatus === 'connected' ? 'Connected' : 'Connecting...'}
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
      <div className="flex-1 relative overflow-hidden">
        {/* Remote Video (Full Screen) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover bg-gray-800"
        />

        {/* Local Video (Picture in Picture) */}
        <div className="absolute top-4 right-4 w-64 h-48 bg-gray-800 rounded-xl overflow-hidden shadow-2xl border-2 border-gray-700">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover mirror"
          />
          {!videoEnabled && (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
              <VideoOff className="w-12 h-12 text-gray-500" />
            </div>
          )}
        </div>

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
            {videoEnabled ? <VideoIcon className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
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
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.sender_id === currentUser.id ? 'justify-end' : 'justify-start'}`}
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
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
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
