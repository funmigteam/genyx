'use client';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import './profile-studio.css';

export type Slot = 'frame' | 'banner' | 'name';
export const slotOf = (key: string): Slot => key.startsWith('banner-') ? 'banner' : key.startsWith('name-') ? 'name' : 'frame';
type ShopItem = { id: string; title: string; description?: string | null; category: string; imageKey: string; genPrice: number };
type Request = <T,>(path: string, init?: RequestInit) => Promise<T>;
export type ProfileLook = { frame: string; banner: string | null; nameEffect: string | null };

/** The profile card everyone sees: banner, animated frame, name effect, rank. */
export function ProfileHero({ name, photoUrl, look, rank, level, bio, children }: { name: string; photoUrl?: string | null; look: ProfileLook; rank?: string; level?: number; bio?: string | null; children?: ReactNode }) {
  return <section className="pf-hero" data-banner={look.banner ?? 'none'}>
    <div className="pf-banner" aria-hidden="true"><i /><i /><i /></div>
    <div className="pf-body">
      <div className="pf-avatar" data-frame={look.frame}>
        <div className="pf-photo">
          {photoUrl ? <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
        </div>
      </div>
      <div className="pf-identity">
        <h2 className="pf-name" data-effect={look.nameEffect ?? 'none'} data-text={name}>{name}</h2>
        {rank && <p className="pf-rank"><span className={`rank-badge rank-${rank.toLowerCase()}`}>{rank}</span>{level !== undefined && <small>Level {level} / 11</small>}</p>}
        {bio && <p className="pf-bio">“{bio}”</p>}
        {children}
      </div>
    </div>
  </section>;
}

/** A small live sample of a cosmetic, used in the studio and the Shop. */
export function CosmeticPreview({ itemKey, label = 'GENYX' }: { itemKey: string; label?: string }) {
  const slot = slotOf(itemKey);
  if (slot === 'banner') return <div className="pf-swatch" data-banner={itemKey} aria-hidden="true"><div className="pf-banner"><i /><i /><i /></div></div>;
  if (slot === 'name') return <div className="pf-swatch pf-swatch-name" aria-hidden="true"><b className="pf-name" data-effect={itemKey} data-text={label}>{label}</b></div>;
  return <div className="pf-swatch pf-swatch-frame" aria-hidden="true"><div className="pf-avatar pf-avatar-mini" data-frame={itemKey}><div className="pf-photo"><span>G</span></div></div></div>;
}

const slotLabels: Record<Slot, string> = { frame: 'Avatar frames', banner: 'Profile banners', name: 'Name effects' };

export function ProfileStudio({ user, items, request, buy, changed }: {
  user: { displayName?: string | null; firstName?: string | null; photoUrl?: string | null; avatarStyle?: string; profileBanner?: string | null; profileNameEffect?: string | null; profileBio?: string | null; profileStyles?: string[]; level: { level: number; rank: string } };
  items: ShopItem[]; request: Request; buy: (id: string) => Promise<void>; changed: () => Promise<void>;
}) {
  const equipped: ProfileLook = { frame: user.avatarStyle ?? 'lion', banner: user.profileBanner ?? null, nameEffect: user.profileNameEffect ?? null };
  const [slot, setSlot] = useState<Slot>('frame');
  const [preview, setPreview] = useState<string | null>(null);
  const [bio, setBio] = useState(user.profileBio ?? ''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const guard = useRef(false);
  const owned = useMemo(() => new Set(user.profileStyles ?? ['lion']), [user.profileStyles]);
  const name = user.displayName || user.firstName || 'GENYX Member';
  const catalog = items.filter(item => item.category === 'PROFILE' && slotOf(item.imageKey) === slot);
  const current = slot === 'frame' ? equipped.frame : slot === 'banner' ? equipped.banner : equipped.nameEffect;
  const look: ProfileLook = preview ? { ...equipped, ...(slotOf(preview) === 'frame' ? { frame: preview } : slotOf(preview) === 'banner' ? { banner: preview } : { nameEffect: preview }) } : equipped;
  const ownedCount = items.filter(item => item.category === 'PROFILE' && owned.has(item.imageKey)).length;

  const run = async (action: () => Promise<void>, done: string) => {
    if (guard.current) return; guard.current = true; setBusy(true); setMessage('');
    try { await action(); setMessage(done); await changed(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Something went wrong.'); }
    finally { guard.current = false; setBusy(false); }
  };
  const equip = (key: string | null) => run(async () => {
    await request('/v1/me/profile-style', { method: 'PATCH', body: JSON.stringify(key ? { style: key } : { slot, style: null }) });
    setPreview(null);
  }, key ? 'Equipped. Everyone viewing your profile sees it now.' : 'Removed.');

  return <section className="pf-studio">
    <ProfileHero name={name} photoUrl={user.photoUrl} look={look} rank={user.level.rank} level={user.level.level} bio={bio || null}>
      {preview && <p className="pf-preview-note">Previewing · <button type="button" onClick={() => setPreview(null)}>Back to my look</button></p>}
    </ProfileHero>

    <div className="pf-collection-head">
      <div><span>PROFILE STUDIO</span><h3>Make your profile yours</h3></div>
      <b>{ownedCount} / {items.filter(item => item.category === 'PROFILE').length} collected</b>
    </div>
    <div className="pf-tabs" role="tablist" aria-label="Profile item type">
      {(Object.keys(slotLabels) as Slot[]).map(id => <button key={id} role="tab" aria-selected={slot === id} onClick={() => { setSlot(id); setPreview(null); }}>{slotLabels[id]}</button>)}
    </div>
    <div className="pf-grid">
      {slot === 'frame' && <article className={current === 'lion' ? 'equipped' : ''}>
        <CosmeticPreview itemKey="lion" /><h4>Classic</h4><small>Default frame</small>
        <button disabled={busy || current === 'lion'} onClick={() => void equip('lion')}>{current === 'lion' ? 'Equipped' : 'Equip'}</button>
      </article>}
      {slot !== 'frame' && <article className={!current ? 'equipped' : ''}>
        <div className="pf-swatch pf-swatch-none" aria-hidden="true">None</div><h4>None</h4><small>Clean look</small>
        <button disabled={busy || !current} onClick={() => void equip(null)}>{!current ? 'Equipped' : 'Remove'}</button>
      </article>}
      {catalog.map(item => {
        const has = owned.has(item.imageKey), isOn = current === item.imageKey;
        return <article key={item.id} className={`${isOn ? 'equipped' : ''}${preview === item.imageKey ? ' previewing' : ''}`}>
          <button type="button" className="pf-tile-preview" onClick={() => setPreview(preview === item.imageKey ? null : item.imageKey)} aria-label={`Preview ${item.title}`}>
            <CosmeticPreview itemKey={item.imageKey} label={name.split(' ')[0].slice(0, 10)} />
          </button>
          <h4>{item.title}</h4><small>{item.description}</small>
          {has
            ? <button disabled={busy || isOn} onClick={() => void equip(item.imageKey)}>{isOn ? 'Equipped' : 'Equip'}</button>
            : <button className="pf-buy" disabled={busy} onClick={() => void run(async () => { await buy(item.id); await request('/v1/me/profile-style', { method: 'PATCH', body: JSON.stringify({ style: item.imageKey }) }); setPreview(null); }, `${item.title} unlocked and equipped!`)}>Unlock · {item.genPrice} GEN</button>}
        </article>;
      })}
    </div>

    <form className="pf-bio-form" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/v1/me/profile-bio', { method: 'PATCH', body: JSON.stringify({ bio }) }); }, 'Bio saved.'); }}>
      <label htmlFor="pf-bio">Profile bio <small>{bio.length} / 80</small></label>
      <input id="pf-bio" maxLength={80} value={bio} onChange={e => setBio(e.target.value)} placeholder="One line about you — shown on your shared profile" />
      <button disabled={busy || bio === (user.profileBio ?? '')}>Save bio</button>
    </form>
    {message && <p role="status" className="pf-message">{message}</p>}
  </section>;
}
