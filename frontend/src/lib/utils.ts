import type { MatchUser, UserProfile } from '../types/api';

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const apiBase = import.meta.env.VITE_API_BASE?.trim()?.replace(/\/$/, '') ?? '';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function getBackendOrigin(): string {
  if (apiBase) {
    return new URL(apiBase).origin;
  }

  return window.location.origin;
}

export function resolveMediaUrl(path?: string | null): string | null {
  if (!path) {
    return null;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${getBackendOrigin()}${path}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return 'Not available';
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return 'just now';
  }

  const target = new Date(value).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((target - now) / 1000);
  const absolute = Math.abs(diffSeconds);

  if (absolute < 60) {
    return relativeFormatter.format(diffSeconds, 'second');
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return relativeFormatter.format(diffDays, 'day');
}

export function getDisplayName(user: Pick<UserProfile, 'display_name' | 'username'>): string;
export function getDisplayName(user: Pick<MatchUser, 'display_name'>): string;
export function getDisplayName(
  user: Pick<UserProfile, 'display_name' | 'username'> | Pick<MatchUser, 'display_name'>,
): string {
  if ('username' in user) {
    return user.display_name || user.username || 'Anonymous user';
  }

  return user.display_name || 'Anonymous user';
}

export function getInitials(label: string): string {
  const compact = label.trim();
  if (!compact) {
    return 'N';
  }

  const tokens = compact.split(/\s+/).slice(0, 2);
  return tokens.map((token) => token.charAt(0).toUpperCase()).join('');
}

export function toNullableNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}
