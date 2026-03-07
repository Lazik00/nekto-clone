// ==============================
//   API & WebSocket CONFIG
// ==============================

const envApiUrl = import.meta.env.VITE_API_URL?.trim();
const envWsUrl = import.meta.env.VITE_WS_URL?.trim();

const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
const wsOrigin =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://localhost:8080";

// Backend API base URL
export const BASE_URL = envApiUrl || origin;

// WebSocket base URL
export const WS_URL = envWsUrl || wsOrigin;

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
  block: "/api/v1/block",
};

// Build full API URL
export const getApiUrl = (endpoint: string): string => `${BASE_URL}${endpoint}`;

// Build full WebSocket URL
export const getWsUrl = (sessionId: string): string => {
  const token = localStorage.getItem("access_token");
  return `${WS_URL}${API_ENDPOINTS.chatWs}/${sessionId}?token=${token}`;
};
