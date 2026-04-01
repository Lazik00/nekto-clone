export type Gender = 'male' | 'female' | 'other';

export type SessionTokens = {
  accessToken: string;
  refreshToken: string | null;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number;
};

export type UserProfile = {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  age: number | null;
  gender: Gender | null;
  country: string | null;
  status: string;
  is_banned: boolean;
  total_matches: number;
  reports_count: number;
  blocked_users_count: number;
  created_at: string;
  last_online: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = {
  email: string;
  username: string;
  password: string;
  confirm_password: string;
  display_name?: string;
};

export type ChangePasswordInput = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

export type MatchPreferences = {
  gender_preference?: Gender;
  age_min?: number;
  age_max?: number;
  country_preference?: string;
};

export type MatchUser = {
  match_id: string;
  user_id: string;
  display_name: string | null;
  gender: Gender | null;
  age: number | null;
  country: string | null;
  bio: string | null;
  avatar_url: string | null;
};

export type MatchSearchResponse =
  | {
      status: 'matched';
      session_id: string;
      match: MatchUser;
    }
  | {
      status: 'queued';
      position?: number;
      wait_message?: string;
    };

export type MatchNotification = {
  type: 'match_found';
  session_id: string;
  match: MatchUser;
};

export type QueueStatus = {
  position: number;
  wait_time_seconds: number;
  estimated_match_in: number;
};

export type SessionSummary = {
  session_id: string;
  opponent: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  started_at: string;
  ended_at: string | null;
  status: string;
};

export type ChatHistoryMessage = {
  id: string;
  sender_id: string;
  content: string;
  message_type: string;
  created_at: string;
};

export type ChatHistoryResponse = {
  session_id: string;
  messages: ChatHistoryMessage[];
};

export type ReportReason =
  | 'harassment'
  | 'hate_speech'
  | 'explicit_content'
  | 'spam'
  | 'inappropriate_behavior'
  | 'other';

export type ReportInput = {
  reported_user_id: string;
  reason: ReportReason;
  description?: string;
  chat_session_id?: string;
};

export type ReportSummary = {
  id: string;
  reported_user_id: string;
  reason: ReportReason;
  status: string;
  created_at: string;
};

export type PendingReport = {
  id: string;
  reason: ReportReason;
  created_at: string;
};

export type BlockedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
};

export type UpdateProfileInput = {
  display_name?: string;
  bio?: string;
  age?: number | null;
  gender?: Gender | null;
  country?: string;
  avatar?: File | null;
};
