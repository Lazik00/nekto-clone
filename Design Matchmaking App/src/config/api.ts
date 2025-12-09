// ==============================
//   API & WebSocket CONFIG
// ==============================

// Backend API base URL
export const BASE_URL = "https://badgatewaydev.tech";

// WebSocket base URL
export const WS_URL = "wss://badgatewaydev.tech";

// API endpoint paths
export const API_ENDPOINTS = {
  login: "/api/v1/login",
  register: "/api/v1/register",
  me: "/api/v1/me",

  find: "/api/v1/find",
  cancel: "/api/v1/cancel",
  queueStatus: "/api/v1/queue-status",

  chatWs: "/api/v1/chat/ws",

  createReport: "/api/v1/create",
  block: "/match/block"
};

// Build full API URL
export const getApiUrl = (endpoint: string): string => {
  return `${BASE_URL}${endpoint}`;
};

// Build full WebSocket URL
export const getWsUrl = (sessionId: string): string => {
  const token = localStorage.getItem("access_token"); // ✔ ALWAYS correct key
  return `${WS_URL}${API_ENDPOINTS.chatWs}/${sessionId}?token=${token}`;
};
