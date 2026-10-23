'use client';
import { useEffect, useState } from 'react';
import { ProfileHero } from './profile-studio';

export type PublicProfile = { displayName: string; level: number; rank?: string; commission: string; avatarStyle?: string; profileBanner?: string | null; profileNameEffect?: string | null; profileBio?: string | null };

/** What anyone opening a shared profile link sees. */
export function PublicProfileCard({ profile }: { profile: PublicProfile }) {
  return <ProfileHero name={profile.displayName} look={{ frame: profile.avatarStyle ?? 'lion', banner: profile.profileBanner ?? null, nameEffect: profile.profileNameEffect ?? null }} rank={profile.rank ?? 'UNRANKED'} level={profile.level} bio={profile.profileBio}>
    <p className="pf-bio">Commission earned: {(Number(profile.commission) / 1_000_000).toLocaleString('en-US')} USDT</p>
  </ProfileHero>;
}

export function SharedProfile({ code, request, close }: { code: string; request: <T,>(path: string) => Promise<T>; close: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void request<PublicProfile>(`/v1/public-profile/${encodeURIComponent(code)}`).then(value => { if (active) setProfile(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [code]);
  return <section className="profile-settings"><small>SHARED PROFILE</small>{profile ? <PublicProfileCard profile={profile} /> : <p role="status">{error || 'Loading profile…'}</p>}<button onClick={close}>Back to my account</button></section>;
}
