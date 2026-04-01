import type {
  BlockedUser,
  ChangePasswordInput,
  ChatHistoryResponse,
  LoginInput,
  MatchNotification,
  MatchPreferences,
  MatchSearchResponse,
  PendingReport,
  RegisterInput,
  ReportInput,
  ReportSummary,
  SessionSummary,
  SessionTokens,
  TokenResponse,
  UpdateProfileInput,
  UserProfile,
} from '../types/api';

const API_PREFIX = '/api/v1';
const AUTH_PREFIX = `${API_PREFIX}/auth`;
const MATCH_PREFIX = `${API_PREFIX}/match`;
const CHAT_PREFIX = `${API_PREFIX}/chat`;
const REPORTS_PREFIX = `${API_PREFIX}/reports`;
const apiBase = import.meta.env.VITE_API_BASE?.trim()?.replace(/\/$/, '') ?? '';
const wsBase = import.meta.env.VITE_WS_BASE?.trim()?.replace(/\/$/, '') ?? '';

type ApiClientOptions = {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokensRefreshed: (session: SessionTokens) => void;
  onUnauthorized: () => void;
};

type RequestOptions = {
  auth?: boolean;
  retryOnUnauthorized?: boolean;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function buildUrl(path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}

function parseApiError(payload: unknown, fallback: string): string {
  if (typeof payload === 'string') {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as { detail?: unknown };
    if (typeof record.detail === 'string') {
      return record.detail;
    }

    if (Array.isArray(record.detail) && record.detail.length > 0) {
      const firstItem = record.detail[0];
      if (typeof firstItem === 'string') {
        return firstItem;
      }

      if (firstItem && typeof firstItem === 'object' && 'msg' in firstItem) {
        const message = (firstItem as { msg?: unknown }).msg;
        if (typeof message === 'string') {
          return message;
        }
      }
    }
  }

  return fallback;
}

export function getWebSocketUrl(sessionId: string, accessToken: string): string {
  const query = `token=${encodeURIComponent(accessToken)}`;

  if (wsBase) {
      return `${wsBase}${CHAT_PREFIX}/ws/${sessionId}?${query}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${CHAT_PREFIX}/ws/${sessionId}?${query}`;
}

export function createApiClient(options: ApiClientOptions) {
  async function refreshTokens(): Promise<SessionTokens | null> {
    const refreshToken = options.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    const path = `${AUTH_PREFIX}/refresh`;
    const response = await fetch(buildUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const payload = (await response.json().catch(() => null)) as TokenResponse | { detail?: unknown } | null;
    if (!response.ok || !payload || !('access_token' in payload)) {
      options.onUnauthorized();
      return null;
    }

    const session = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
    };

    options.onTokensRefreshed(session);
    return session;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const auth = requestOptions.auth ?? true;
    const retryOnUnauthorized = requestOptions.retryOnUnauthorized ?? true;

    const headers = new Headers(init.headers);
    if (auth) {
      const token = options.getAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(buildUrl(path), {
      ...init,
      headers,
    });

    const contentType = response.headers.get('content-type');
    const payload = contentType?.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (response.status === 401 && auth && retryOnUnauthorized) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        return request<T>(path, init, { auth, retryOnUnauthorized: false });
      }
    }

    if (!response.ok) {
      throw new ApiError(
        parseApiError(payload, 'Request failed. Please try again.'),
        response.status,
      );
    }

    return payload as T;
  }

  return {
    login(payload: LoginInput) {
      return request<TokenResponse>(
        `${AUTH_PREFIX}/login`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        { auth: false },
      );
    },
    register(payload: RegisterInput) {
      return request<TokenResponse>(
        `${AUTH_PREFIX}/register`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        { auth: false },
      );
    },
    getMe() {
      return request<UserProfile>(`${AUTH_PREFIX}/me`);
    },
    updateProfile(input: UpdateProfileInput) {
      const formData = new FormData();

      if (input.display_name !== undefined) {
        formData.set('display_name', input.display_name);
      }
      if (input.bio !== undefined) {
        formData.set('bio', input.bio);
      }
      if (input.age !== undefined && input.age !== null) {
        formData.set('age', String(input.age));
      }
      if (input.gender !== undefined && input.gender !== null) {
        formData.set('gender', input.gender);
      }
      if (input.country !== undefined) {
        formData.set('country', input.country);
      }
      if (input.avatar) {
        formData.set('avatar', input.avatar);
      }

      return request<UserProfile>(`${AUTH_PREFIX}/me`, {
        method: 'PUT',
        body: formData,
      });
    },
    changePassword(payload: ChangePasswordInput) {
      return request<{ message: string }>(`${AUTH_PREFIX}/change-password`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    findMatch(payload: MatchPreferences) {
      return request<MatchSearchResponse>(`${MATCH_PREFIX}/find`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getNotifications() {
      return request<{ notifications: MatchNotification[] }>(`${MATCH_PREFIX}/notifications`);
    },
    getQueueStatus() {
      return request<{
        position: number;
        wait_time_seconds: number;
        estimated_match_in: number;
      }>(`${MATCH_PREFIX}/queue-status`);
    },
    cancelMatchmaking() {
      return request<{ message: string }>(`${MATCH_PREFIX}/cancel`, {
        method: 'POST',
      });
    },
    getChatSessions() {
      return request<{ sessions: SessionSummary[] }>(`${CHAT_PREFIX}/sessions`);
    },
    getChatHistory(sessionId: string) {
      return request<ChatHistoryResponse>(`${CHAT_PREFIX}/history/${sessionId}`);
    },
    blockUser(userId: string) {
      return request<{ message: string }>(`${MATCH_PREFIX}/block/${userId}`, {
        method: 'POST',
      });
    },
    unblockUser(userId: string) {
      return request<{ message: string }>(`${MATCH_PREFIX}/unblock/${userId}`, {
        method: 'POST',
      });
    },
    getBlockedUsers() {
      return request<{ blocked_users: BlockedUser[] }>(`${MATCH_PREFIX}/blocked-list`);
    },
    createReport(payload: ReportInput) {
      return request<{ id: string; status: string }>(`${REPORTS_PREFIX}/create`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getMyReports() {
      return request<{ reports: ReportSummary[] }>(`${REPORTS_PREFIX}/my-reports`);
    },
    getPendingReports() {
      return request<{ pending_reports_count: number; reports: PendingReport[] }>(
        `${REPORTS_PREFIX}/pending`,
      );
    },
  };
}
