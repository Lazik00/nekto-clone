// ==============================
//   API & WebSocket CONFIG
// ==============================

// Backend API base URL
export const BASE_URL = "https://badgatewaydev.tech";

// WebSocket base URL
export const WS_URL = "wss://badgatewaydev.tech";

// API endpoint paths
export const API_ENDPOINTS = {
  // Auth
  login: "/api/v1/login",
  register: "/api/v1/register",
  me: "/api/v1/me",

  // Matching
  find: "/api/v1/find",
  cancel: "/api/v1/cancel",
  queueStatus: "/api/v1/queue-status",

  // Chat WS endpoint
  chatWs: "/api/v1/chat/ws",

  // Reports
  createReport: "/api/v1/create",

  // Block system
  block: "/match/block",
};

// Build a full API URL
export const getApiUrl = (endpoint: string): string => {
  return `${BASE_URL}${endpoint}`;
};

// Build a full WebSocket URL
// Build a full WebSocket URL (correct)
export const getWsUrl = (sessionId: string, token: string): string => {
  return `${WS_URL}${API_ENDPOINTS.chatWs}/${sessionId}?token=${token}`;
};


