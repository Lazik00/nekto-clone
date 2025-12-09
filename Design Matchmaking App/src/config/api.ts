// API Configuration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getEnvVar = (key: string, defaultValue: string): string => {
  // Try to get from Vite's import.meta.env
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env: any = (import.meta as any)?.env || {};
    return env[key] || defaultValue;
  } catch {
    return defaultValue;
  }
};

// Get the base URL and ensure it has proper protocol
const getBaseUrl = (): string => {
  const envUrl = getEnvVar('VITE_API_URL', '');

  if (envUrl) {
    // Ensure the URL starts with https:// or http://
    if (!envUrl.startsWith('http://') && !envUrl.startsWith('https://')) {
      return `https://${envUrl}`;
    }
    return envUrl;
  }

  // Fallback: use current window location for production
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${protocol}//${hostname}${port}`;
  }

  return 'https://badgatewaydev.tech';
};

// Get WebSocket URL with proper protocol
const getWsBaseUrl = (): string => {
  const envWsUrl = getEnvVar('VITE_WS_URL', '');

  if (envWsUrl) {
    // Ensure the URL starts with wss:// or ws://
    if (!envWsUrl.startsWith('wss://') && !envWsUrl.startsWith('ws://')) {
      return `wss://${envWsUrl}`;
    }
    return envWsUrl;
  }

  // Determine WS protocol based on page protocol
  if (typeof window !== 'undefined') {
    const isSecure = window.location.protocol === 'https:';
    const hostname = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    const protocol = isSecure ? 'wss://' : 'ws://';
    return `${protocol}${hostname}${port}`;
  }

  return 'wss://badgatewaydev.tech';
};

export const API_CONFIG = {
  // Backend server URL
  BASE_URL: getBaseUrl(),

  // WebSocket URL
  WS_URL: getWsBaseUrl(),

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
    chatWs: '/api/v1/chat/ws',

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
  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_CONFIG.WS_URL}${cleanPath}`;
};

