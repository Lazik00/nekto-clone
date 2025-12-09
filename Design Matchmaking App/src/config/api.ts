// API Configuration
const getEnvVar = (key: string, defaultValue: string): string => {
  return (import.meta as any).env?.[key] || defaultValue;
};

export const API_CONFIG = {
  // Backend server URL
  BASE_URL: getEnvVar('VITE_API_URL', 'https://badgatewaydev.tech'),

  // WebSocket URL (ws:// yoki wss://)
  WS_URL: getEnvVar('VITE_WS_URL', 'wss:/badgatewaydev.tech'),

  // API endpoints
  endpoints: {
    // Auth
    login: '/api/v1/login',
    register: '/api/v1/register',
    me: '/api/v1/me',

    // Matching
    find: '/api/v1/find',
    cancel: '/api/v1/cancel',
    queueStatus: '/api/v1/queue-status',

    // Chat
    chatWs: '/chat/ws',

    // Reports
    createReport: '/api/v1/create',

    // Block
    block: '/match/block',
  },
};

// Helper function to get full API URL
export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};

// Helper function to get WebSocket URL
export const getWsUrl = (path: string): string => {
  // WebSocket URL should include /api/v1 prefix
  return `${API_CONFIG.WS_URL}/api/v1${path}`;
};

