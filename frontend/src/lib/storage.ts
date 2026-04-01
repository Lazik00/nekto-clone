import type { SessionTokens } from '../types/api';

const STORAGE_KEY = 'nekto.session';

export function readStoredSession(): SessionTokens | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SessionTokens;
    if (!parsed.accessToken) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
    };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: SessionTokens): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
