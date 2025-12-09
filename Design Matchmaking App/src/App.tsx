import { useState, useEffect } from 'react';
import { AuthPage } from './components/AuthPage';
import { HomePage } from './components/HomePage';
import { ChatRoom } from './components/ChatRoom';
import { ProfilePage } from './components/ProfilePage';
import { SettingsPage } from './components/SettingsPage';
import { getApiUrl } from './config/api';

export type User = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  age?: number;
  gender?: string;
  country?: string;
};

export type AppView = 'auth' | 'home' | 'chat' | 'profile' | 'settings';

export default function App() {
  const [view, setView] = useState<AppView>('auth');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [matchUser, setMatchUser] = useState<User | null>(null);

  useEffect(() => {
    const storedAccess = localStorage.getItem("access_token");
    const storedRefresh = localStorage.getItem("refresh_token");

    if (storedAccess && storedRefresh) {
      setAccessToken(storedAccess);
      setRefreshToken(storedRefresh);
      fetchUserProfile(storedAccess);
    }
  }, []);

  // ===============================
  //    USER PROFILE FETCHER
  // ===============================
  const fetchUserProfile = async (token: string) => {
    try {
      const response = await fetch(getApiUrl("/api/v1/me"), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        handleLogout();
        return;
      }

      const data = await response.json();
      setUser(data);
      setView("home");
    } catch (err) {
      console.error("Profile load failed", err);
      handleLogout();
    }
  };

  // ===============================
  //             LOGIN
  // ===============================
  const handleLogin = (token: string, refresh: string) => {
    localStorage.setItem("access_token", token);
    localStorage.setItem("refresh_token", refresh);

    setAccessToken(token);
    setRefreshToken(refresh);

    fetchUserProfile(token);
  };

  // ===============================
  //            LOGOUT
  // ===============================
  const handleLogout = () => {
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setSessionId(null);
    setMatchUser(null);

    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");

    setView("auth");
  };

  // ===============================
  //         MATCH FOUND
  // ===============================
  const handleMatchFound = (session: string, match: User) => {
    setSessionId(session);
    setMatchUser(match);
    setView("chat");
  };

  const handleEndChat = () => {
    setSessionId(null);
    setMatchUser(null);
    setView("home");
  };

  const handleUpdateProfile = (updated: User) => {
    setUser(updated);
  };

  // ===============================
  //        VIEW RENDER LOGIC
  // ===============================

  if (view === "auth") {
    return <AuthPage onLogin={handleLogin} />;
  }

  if (view === "chat" && sessionId && matchUser && accessToken && user) {
    return (
      <ChatRoom
        sessionId={sessionId}
        accessToken={accessToken}
        currentUser={user}
        matchUser={matchUser}
        onEndChat={handleEndChat}
        onBack={() => setView("home")}
      />
    );
  }

  if (view === "profile" && user && accessToken) {
    return (
      <ProfilePage
        user={user}
        accessToken={accessToken}
        onBack={() => setView("home")}
        onUpdateProfile={handleUpdateProfile}
      />
    );
  }

  if (view === "settings" && accessToken) {
    return (
      <SettingsPage
        accessToken={accessToken}
        onBack={() => setView("home")}
        onLogout={handleLogout}
      />
    );
  }

  if (view === "home" && user && accessToken) {
    return (
      <HomePage
        user={user}
        accessToken={accessToken}
        onMatchFound={handleMatchFound}
        onNavigateToProfile={() => setView("profile")}
        onNavigateToSettings={() => setView("settings")}
        onLogout={handleLogout}
      />
    );
  }

  return null;
}
