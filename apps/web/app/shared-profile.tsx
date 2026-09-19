'use client';
import { useEffect, useState } from 'react';
export function SharedProfile({ code, request, close }: { code: string; request: <T,>(path: string) => Promise<T>; close: () => void }) {
  const [profile, setProfile] = useState<{ displayName: string; level: number; season: number; commission: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void request<NonNullable<typeof profile>>(`/v1/public-profile/${encodeURIComponent(code)}`).then(value => { if (active) setProfile(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [code]);
  return <section className="profile-settings"><small>SHARED PROFILE</small>{profile ? <><h2>{profile.displayName}</h2><p>Level {profile.level} · Season {profile.season}</p><p>Commission: {Number(profile.commission) / 1000000} USDT</p></> : <p role="status">{error || 'Loading profile…'}</p>}<button onClick={close}>Back to my account</button></section>;
}
