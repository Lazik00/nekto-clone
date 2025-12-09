import { useState, useEffect } from 'react';
import { Video, Settings, UserCircle, LogOut, Search, X, Sliders } from 'lucide-react';
import { PermissionCheck } from './PermissionCheck';
import type { User } from '../App';
import { getApiUrl } from '../config/api';

type HomePageProps = {
  user: User;
  accessToken: string;
  onMatchFound: (sessionId: string, matchUser: User) => void;
  onNavigateToProfile: () => void;
  onNavigateToSettings: () => void;
  onLogout: () => void;
};


type MatchPreferences = {
  gender?: string;
  age_range?: [number, number];
};

export function HomePage({ 
  user, 
  accessToken, 
  onMatchFound, 
  onNavigateToProfile,
  onNavigateToSettings,
  onLogout 
}: HomePageProps) {
  const [searching, setSearching] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showPermissionCheck, setShowPermissionCheck] = useState(false);
  const [preferences, setPreferences] = useState<MatchPreferences>({});
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [pollInterval]);

  const pollQueueStatus = async () => {
    try {
      const response = await fetch(getApiUrl('/api/v1/queue-status'), {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setQueuePosition(data.position);
      }
    } catch (error) {
      console.error('Failed to poll queue status:', error);
    }
  };

  const handleStartSearch = async () => {
    // Show permission check first
    setShowPermissionCheck(true);
  };

  const handlePermissionsGranted = async () => {
    setShowPermissionCheck(false);
    setSearching(true);
    setQueuePosition(null);

    try {
      const response = await fetch(getApiUrl('/api/v1/find'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ preferences })
      });

      const data = await response.json();

      if (data.status === 'matched') {
        // Immediate match
        onMatchFound(data.session_id, data.match);
        setSearching(false);
        if (pollInterval) clearInterval(pollInterval);
      } else if (data.status === 'queued') {
        // Start polling for queue status and check for match
        const interval = setInterval(async () => {
          await pollQueueStatus();
          
          // Check if match is found
          const matchResponse = await fetch(getApiUrl('/api/v1/find'), {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ preferences })
          });

          const matchData = await matchResponse.json();
          if (matchData.status === 'matched') {
            clearInterval(interval);
            onMatchFound(matchData.session_id, matchData.match);
            setSearching(false);
          }
        }, 2000);

        setPollInterval(interval);
      }
    } catch (error) {
      console.error('Failed to start matchmaking:', error);
      setSearching(false);
    }
  };

  const handleCancelSearch = async () => {
    try {
      await fetch(getApiUrl('/api/v1/cancel'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (pollInterval) {
        clearInterval(pollInterval);
        setPollInterval(null);
      }

      setSearching(false);
      setQueuePosition(null);
    } catch (error) {
      console.error('Failed to cancel matchmaking:', error);
    }
  };

  return (
    <>
      {showPermissionCheck && (
        <PermissionCheck
          onPermissionsGranted={handlePermissionsGranted}
          onCancel={() => setShowPermissionCheck(false)}
        />
      )}

      {!showPermissionCheck && (
        <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
              <Video className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-white text-xl">VidConnect</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onNavigateToProfile}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            >
              <UserCircle className="w-4 h-4" />
              {user.display_name || user.username}
            </button>
            <button
              onClick={onNavigateToSettings}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h1 className="text-white text-6xl mb-4">
            {searching ? 'Finding your match...' : 'Ready to connect?'}
          </h1>
          <p className="text-white/90 text-xl">
            {searching 
              ? 'We\'re searching for someone awesome to chat with'
              : 'Click start to begin a random video chat with someone new'
            }
          </p>
          {queuePosition !== null && (
            <div className="mt-4 text-white/80 text-lg">
              Queue position: <span className="font-bold">#{queuePosition}</span>
            </div>
          )}
        </div>

        {/* Start Button */}
        <div className="text-center mb-8">
          {!searching ? (
            <button
              onClick={handleStartSearch}
              className="group relative inline-flex items-center gap-3 px-12 py-6 bg-white text-purple-600 rounded-full text-xl hover:scale-105 transition-transform shadow-2xl"
            >
              <Search className="w-6 h-6" />
              Start Chatting
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity" />
            </button>
          ) : (
            <button
              onClick={handleCancelSearch}
              className="inline-flex items-center gap-3 px-12 py-6 bg-red-500 text-white rounded-full text-xl hover:bg-red-600 transition-colors shadow-2xl"
            >
              <X className="w-6 h-6" />
              Cancel Search
            </button>
          )}
        </div>

        {/* Preferences Button */}
        <div className="text-center mb-12">
          <button
            onClick={() => setShowPreferences(!showPreferences)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 text-white rounded-full transition backdrop-blur-sm"
          >
            <Sliders className="w-4 h-4" />
            Match Preferences
          </button>
        </div>

        {/* Preferences Panel */}
        {showPreferences && (
          <div className="bg-white rounded-3xl p-8 shadow-2xl mb-8">
            <h3 className="text-2xl mb-6">Match Preferences</h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-gray-700 mb-2">Gender Preference</label>
                <select
                  value={preferences.gender || ''}
                  onChange={(e) => setPreferences({ ...preferences, gender: e.target.value || undefined })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                >
                  <option value="">Any</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-2">Age Range</label>
                <div className="flex gap-4">
                  <input
                    type="number"
                    placeholder="Min"
                    value={preferences.age_range?.[0] || ''}
                    onChange={(e) => {
                      const min = parseInt(e.target.value) || undefined;
                      const max = preferences.age_range?.[1];
                      setPreferences({ 
                        ...preferences, 
                        age_range: min && max ? [min, max] : undefined 
                      });
                    }}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={preferences.age_range?.[1] || ''}
                    onChange={(e) => {
                      const max = parseInt(e.target.value) || undefined;
                      const min = preferences.age_range?.[0];
                      setPreferences({ 
                        ...preferences, 
                        age_range: min && max ? [min, max] : undefined 
                      });
                    }}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                  />
                </div>
              </div>

              <button
                onClick={() => setShowPreferences(false)}
                className="w-full bg-purple-600 text-white py-3 rounded-xl hover:bg-purple-700 transition"
              >
                Save Preferences
              </button>
            </div>
          </div>
        )}

        {/* Loading Animation */}
        {searching && (
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-white/30 rounded-full" />
              <div className="absolute inset-0 w-24 h-24 border-4 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-3 gap-6 mt-16">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Video className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white mb-2">Video Chat</h3>
            <p className="text-white/80 text-sm">High-quality video calls with strangers worldwide</p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white mb-2">Smart Matching</h3>
            <p className="text-white/80 text-sm">Advanced algorithm finds the perfect chat partner</p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserCircle className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-white mb-2">Safe & Secure</h3>
            <p className="text-white/80 text-sm">Report and block features keep you protected</p>
          </div>
        </div>
      </div>
    </div>
    )}
    </>
  );
}
