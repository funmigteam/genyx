'use client';
export function ProfileEditor({ name }: { name: string; language: string; save: (value: { displayName: string; language: string }) => Promise<void> }) {
  return <section className="profile-settings"><h2>Telegram profile</h2>
    <label>Telegram name<input readOnly value={name} /></label>
    <p>Your name is synchronized from Telegram. To change it, update Telegram and reopen the Mini App.</p>
    <p>Language: English</p>
  </section>;
}
