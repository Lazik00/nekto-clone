/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { clearStoredSession, readStoredSession, writeStoredSession } from '../lib/storage';
import { createApiClient } from '../services/api';
import type {
  LoginInput,
  RegisterInput,
  SessionTokens,
  TokenResponse,
  UserProfile,
} from '../types/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  api: ReturnType<typeof createApiClient>;
  login: (payload: LoginInput) => Promise<void>;
  register: (payload: RegisterInput) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  setUser: (user: UserProfile) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toSessionTokens(payload: TokenResponse): SessionTokens {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUserState] = useState<UserProfile | null>(null);
  const sessionRef = useRef<SessionTokens | null>(null);

  const logout = () => {
    sessionRef.current = null;
    setAccessToken(null);
    setRefreshToken(null);
    setUserState(null);
    setStatus('anonymous');
    clearStoredSession();
  };

  const applyTokens = (session: SessionTokens) => {
    sessionRef.current = session;
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    writeStoredSession(session);
  };

  const api = createApiClient({
    getAccessToken: () => sessionRef.current?.accessToken ?? null,
    getRefreshToken: () => sessionRef.current?.refreshToken ?? null,
    onTokensRefreshed: applyTokens,
    onUnauthorized: logout,
  });

  const refreshProfile = async () => {
    const profile = await api.getMe();
    setUserState(profile);
    setStatus('authenticated');
  };

  const authenticateWithTokenPayload = async (payload: TokenResponse) => {
    applyTokens(toSessionTokens(payload));
    await refreshProfile();
  };

  const login = async (payload: LoginInput) => {
    const response = await api.login(payload);
    await authenticateWithTokenPayload(response);
  };

  const register = async (payload: RegisterInput) => {
    const response = await api.register(payload);
    await authenticateWithTokenPayload(response);
  };

  const setUser = (nextUser: UserProfile) => {
    setUserState(nextUser);
  };

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setStatus('anonymous');
      return;
    }

    sessionRef.current = stored;
    setAccessToken(stored.accessToken);
    setRefreshToken(stored.refreshToken);

    let cancelled = false;

    void (async () => {
      try {
        const profile = await api.getMe();
        if (cancelled) {
          return;
        }

        setUserState(profile);
        setStatus('authenticated');
      } catch {
        if (!cancelled) {
          logout();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        accessToken,
        refreshToken,
        user,
        api,
        login,
        register,
        logout,
        refreshProfile,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
