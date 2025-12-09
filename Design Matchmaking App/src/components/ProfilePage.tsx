import { useState } from 'react';
import { ArrowLeft, User as UserIcon, Edit2, Save } from 'lucide-react';
import { User } from '../App';

type ProfilePageProps = {
  user: User;
  accessToken: string;
  onBack: () => void;
  onUpdateProfile: (user: User) => void;
};

export function ProfilePage({ user, accessToken, onBack, onUpdateProfile }: ProfilePageProps) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [bio, setBio] = useState(user.bio || '');
  const [age, setAge] = useState(user.age?.toString() || '');
  const [gender, setGender] = useState(user.gender || '');
  const [country, setCountry] = useState(user.country || '');

  const handleSave = async () => {
    // In a real app, you'd make an API call to update the profile
    // For now, we'll just update locally
    const updatedUser: User = {
      ...user,
      display_name: displayName,
      bio,
      age: age ? parseInt(age) : undefined,
      gender,
      country
    };

    onUpdateProfile(updatedUser);
    setEditing(false);
  };

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
          <h1 className="text-white text-xl">Profile</h1>
          <div className="w-20" />
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Profile Header */}
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-12 text-center">
            <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-lg">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span className="text-purple-600">
                  {(user.display_name || user.username)[0].toUpperCase()}
                </span>
              )}
            </div>
            <h2 className="text-white text-3xl mb-2">
              {user.display_name || user.username}
            </h2>
            <p className="text-white/90">@{user.username}</p>
          </div>

          {/* Profile Info */}
          <div className="p-8">
            {!editing ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Display Name</label>
                  <p className="text-gray-900">{user.display_name || 'Not set'}</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-500 mb-1">Bio</label>
                  <p className="text-gray-900">{user.bio || 'No bio yet'}</p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Age</label>
                    <p className="text-gray-900">{user.age || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Gender</label>
                    <p className="text-gray-900 capitalize">{user.gender || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Country</label>
                    <p className="text-gray-900">{user.country || 'Not set'}</p>
                  </div>
                </div>

                <button
                  onClick={() => setEditing(true)}
                  className="w-full bg-purple-600 text-white py-3 rounded-xl hover:bg-purple-700 transition flex items-center justify-center gap-2"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Profile
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                    placeholder="Your display name"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-2">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none resize-none"
                    rows={3}
                    placeholder="Tell us about yourself"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Age</label>
                    <input
                      type="number"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                      placeholder="Age"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Gender</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                    >
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Country</label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none"
                      placeholder="Country"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    className="flex-1 bg-purple-600 text-white py-3 rounded-xl hover:bg-purple-700 transition flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save Changes
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
