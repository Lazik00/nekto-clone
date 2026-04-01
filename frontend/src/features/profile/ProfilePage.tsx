import { ImagePlus, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { formatDateTime, getDisplayName, getInitials, resolveMediaUrl, toNullableNumber } from '../../lib/utils';
import { ApiError } from '../../services/api';

export function ProfilePage() {
  const { api, setUser, user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [age, setAge] = useState(user?.age ? String(user.age) : '');
  const [gender, setGender] = useState(user?.gender ?? '');
  const [country, setCountry] = useState(user?.country ?? '');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setDisplayName(user?.display_name ?? '');
    setBio(user?.bio ?? '');
    setAge(user?.age ? String(user.age) : '');
    setGender(user?.gender ?? '');
    setCountry(user?.country ?? '');
  }, [user]);

  useEffect(() => {
    if (!avatar) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(avatar);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatar]);

  if (!user) {
    return null;
  }

  const avatarUrl = previewUrl || resolveMediaUrl(user.avatar_url);
  const display = getDisplayName(user);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        age: toNullableNumber(age),
        gender: gender ? (gender as 'male' | 'female' | 'other') : null,
        country: country.trim(),
        avatar,
      });
      setUser(response);
      setAvatar(null);
      setSuccess('Profile synced with backend.');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('Could not update profile.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="content-grid profile-grid">
        <article className="surface profile-card">
          <div className="profile-card__header">
            {avatarUrl ? (
              <img className="profile-card__avatar" src={avatarUrl} alt={display} />
            ) : (
              <div className="profile-card__fallback">{getInitials(display)}</div>
            )}
            <div>
              <div className="eyebrow">Identity</div>
              <h1>{display}</h1>
              <p>{user.email || 'No email available'}</p>
            </div>
          </div>

          <div className="stats-grid">
            <div className="metric-card">
              <strong>{user.total_matches}</strong>
              <span>Total matches</span>
            </div>
            <div className="metric-card">
              <strong>{user.blocked_users_count}</strong>
              <span>Blocked users</span>
            </div>
            <div className="metric-card">
              <strong>{formatDateTime(user.created_at)}</strong>
              <span>Joined</span>
            </div>
          </div>
        </article>

        <article className="surface">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Editable profile</div>
              <h3>Multipart update to `/api/v1/auth/me`</h3>
            </div>
          </div>

          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              <span>Display name</span>
              <input
                className="input"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Public facing name"
              />
            </label>

            <label className="field">
              <span>Country</span>
              <input
                className="input"
                type="text"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="Uzbekistan"
              />
            </label>

            <label className="field">
              <span>Age</span>
              <input
                className="input"
                type="number"
                min={13}
                max={120}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                placeholder="24"
              />
            </label>

            <label className="field">
              <span>Gender</span>
              <select className="input" value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="field field--full">
              <span>Bio</span>
              <textarea
                className="textarea"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="How should other users experience this profile?"
                rows={5}
                maxLength={500}
              />
            </label>

            <label className="field field--full">
              <span>Avatar</span>
              <div className="uploader">
                <label className="button button--secondary" htmlFor="avatar-upload">
                  <ImagePlus size={16} />
                  Choose image
                </label>
                <input
                  id="avatar-upload"
                  className="uploader__input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => setAvatar(event.target.files?.[0] ?? null)}
                />
                <span className="field-footnote">
                  JPG, PNG, WEBP, or GIF. Backend enforces a 5MB limit.
                </span>
              </div>
            </label>

            {error ? <div className="notice notice--error">{error}</div> : null}
            {success ? <div className="notice notice--success">{success}</div> : null}

            <button className="button button--primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Saving profile...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save changes
                </>
              )}
            </button>
          </form>
        </article>
      </section>
    </div>
  );
}
