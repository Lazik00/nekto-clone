import { useState } from 'react';
import { ArrowLeft, Bell, Shield, Eye, Globe, LogOut, Trash2 } from 'lucide-react';

type SettingsPageProps = {
  accessToken: string;
  onBack: () => void;
  onLogout: () => void;
};

export function SettingsPage({ accessToken, onBack, onLogout }: SettingsPageProps) {
  const [notifications, setNotifications] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-white hover:text-white/80 transition"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-white text-xl">Settings</h1>
          <div className="w-20" />
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Notifications */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <Bell className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-gray-900">Notifications</h3>
                  <p className="text-sm text-gray-500">Receive match notifications</p>
                </div>
              </div>
              <button
                onClick={() => setNotifications(!notifications)}
                className={`w-12 h-6 rounded-full transition ${
                  notifications ? 'bg-purple-600' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    notifications ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Privacy */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-gray-900">Privacy</h3>
            </div>

            <div className="space-y-4 ml-13">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-900">Public Profile</p>
                  <p className="text-sm text-gray-500">Allow others to see your profile</p>
                </div>
                <button
                  onClick={() => setPublicProfile(!publicProfile)}
                  className={`w-12 h-6 rounded-full transition ${
                    publicProfile ? 'bg-purple-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      publicProfile ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-900">Online Status</p>
                  <p className="text-sm text-gray-500">Show when you're active</p>
                </div>
                <button
                  onClick={() => setShowOnlineStatus(!showOnlineStatus)}
                  className={`w-12 h-6 rounded-full transition ${
                    showOnlineStatus ? 'bg-purple-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      showOnlineStatus ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Language */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Globe className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-gray-900">Language</h3>
                  <p className="text-sm text-gray-500">Choose your preferred language</p>
                </div>
              </div>
              <select className="px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-purple-500">
                <option>English</option>
                <option>Español</option>
                <option>Français</option>
                <option>Deutsch</option>
                <option>O'zbek</option>
              </select>
            </div>
          </div>

          {/* Blocked Users */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Eye className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-gray-900">Blocked Users</h3>
                <p className="text-sm text-gray-500">Manage your blocked list</p>
              </div>
            </div>
          </div>

          {/* Account Actions */}
          <div className="p-6 space-y-3">
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition"
            >
              <LogOut className="w-5 h-5" />
              Logout
            </button>

            <button className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition">
              <Trash2 className="w-5 h-5" />
              Delete Account
            </button>
          </div>
        </div>

        {/* About */}
        <div className="mt-8 text-center text-white/80 text-sm">
          <p>VidConnect v1.0.0</p>
          <p className="mt-2">© 2025 VidConnect. All rights reserved.</p>
          <div className="flex justify-center gap-6 mt-4">
            <a href="#" className="hover:text-white transition">Terms of Service</a>
            <a href="#" className="hover:text-white transition">Privacy Policy</a>
            <a href="#" className="hover:text-white transition">Support</a>
          </div>
        </div>
      </div>
    </div>
  );
}
