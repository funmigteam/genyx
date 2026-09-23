'use client';
import './entry-welcome.css';
import { TeamTree } from './team-tree';
import { useEffect, useState } from 'react';
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Stats = { displayName: string; shareCode: string; publicProfile: boolean; nodes: number; direct: number; team: string; maxCap: string; capConsumed: string; level: number; season: number; day: number; leftVolume: string; rightVolume: string; cycles: string; vouchers: number };
export function CommunityPanel({ request }: { request: Request }) {
  const [stats, setStats] = useState<Stats | null>(null), [message, setMessage] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [ranking, setRanking] = useState<{ me: { rank: string } | null; rows: { rank: string; name: string; amount: string; shareCode: string | null }[] } | null>(null);
  const [publicUser, setPublicUser] = useState<{ displayName: string; level: number; season: number; commission: string } | null>(null);
  useEffect(() => { const update = () => { void request<Stats>('/v1/me/stats').then(setStats).catch(e => setMessage(e.message)); void request<typeof ranking>('/v1/commission-leaderboard').then(setRanking).catch(e => setMessage(e.message)); }; update(); const timer = setInterval(update, 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const telegram = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } }).Telegram;
    const start = telegram?.WebApp?.initDataUnsafe?.start_param || new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam');
    if (start?.startsWith('profile_')) request<typeof publicUser>(`/v1/public-profile/${encodeURIComponent(start.slice(8))}`).then(setPublicUser).catch(e=>setMessage(e.message));
  }, []);
  const money = (n: string) => (Number(n)/1000000).toLocaleString('en-US');
  return <section className="profile-settings network-panel" dir="ltr" lang="en"><h2>Team statistics</h2><p role="status">{message}</p>{stats && <>
    <section className="ref-card"><span>YOUR REFERRAL CODE</span><strong className="referral-code">{stats.shareCode || 'Not available'}</strong><span>YOUR TRACKED REFERRAL LINK</span><code>{`https://t.me/smartgenyx_bot?startapp=ref_${stats.shareCode || ''}`}</code><button type="button" className="referral-copy" disabled={!stats.shareCode} onClick={async () => { try { await navigator.clipboard.writeText(`https://t.me/smartgenyx_bot?startapp=ref_${stats.shareCode}`); setMessage("Referral link copied. It opens GENYX directly in Telegram."); } catch { setMessage("Could not copy. Select and copy the link above."); } }}>Copy referral link</button></section>
    <div className="profile-stats">{Object.entries({ 'Team': stats.team, 'Total max cap': `${money(stats.maxCap)} USDT`, 'Used max cap': `${money(stats.capConsumed)} USDT`, 'Level': stats.level, 'Season': stats.season, 'Season day': stats.day, 'Direct referrals': stats.direct,  'Left lifetime cycles': `${Number(stats.leftVolume) / 5000000} Cycles`, 'Cash cycles': stats.cycles, 'Right lifetime cycles': `${Number(stats.rightVolume) / 5000000} Cycles`, 'Available vouchers': stats.vouchers }).map(([label, value]) => <article key={label}><small>{label}</small><h3>{value}</h3></article>)}</div>
    <p>Team volume is shown in Cycles (1 Cycle = 5 USDT volume). Financial amounts are in USDT. Public profiles show only name, level, season and commission.</p>
    <button type="button" className={`public-profile-toggle ${stats.publicProfile ? 'is-enabled' : ''}`} aria-pressed={stats.publicProfile} disabled={profileBusy} onClick={async () => { setProfileBusy(true); try { const next = !stats.publicProfile; await request('/v1/me/share-profile', { method: 'POST', body: JSON.stringify({ enabled: next }) }); setStats({ ...stats, publicProfile: next }); setMessage(next ? 'Public profile enabled.' : 'Public profile disabled.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'Request failed'); } finally { setProfileBusy(false); } }}>
      <span><b>Public profile</b><small>{stats.publicProfile ? 'Your share link is visible to other GENYX members.' : 'Only you can view your profile details.'}</small></span><i aria-hidden="true" /> <strong>{profileBusy ? 'Saving…' : stats.publicProfile ? 'Enabled' : 'Enable'}</strong>
    </button>
    <button type="button" className="profile-share-button" disabled={!stats.publicProfile || !stats.shareCode || profileBusy} onClick={async () => {
      const url = `https://t.me/smartgenyx_bot?startapp=profile_${stats.shareCode}`;
      const text = `View ${stats.displayName}'s GENYX profile`;
      try {
        if (navigator.share) await navigator.share({ title: stats.displayName, text, url });
        else {
          const telegramShare = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
          const popup = window.open(telegramShare, '_blank', 'noopener,noreferrer');
          if (!popup) { await navigator.clipboard.writeText(url); setMessage('Profile link copied.'); }
          else setMessage('Choose a Telegram chat to share your profile.');
        }
      } catch {
        try { await navigator.clipboard.writeText(url); setMessage('Profile link copied.'); }
        catch { setMessage('Enable your public profile first, then try again.'); }
      }
    }}>Share profile</button>
  </>}
  <TeamTree request={request} />
  {publicUser && <article><h3>{publicUser.displayName}</h3><p>Level {publicUser.level} · Season {publicUser.season} · Commission {money(publicUser.commission)} USDT</p><button onClick={() => setPublicUser(null)}>Close</button></article>}
  </section>;
}

export function EntryGate({ request, name, languageChosen, initialChannels, done }: { request: Request; name: string; languageChosen: boolean; initialChannels: { title: string; inviteUrl: string; verified: boolean }[]; done: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const [channels, setChannels] = useState<{ title: string; inviteUrl: string; verified: boolean }[]>(initialChannels), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  return <section className="profile-settings entry-welcome" dir="ltr" lang="en"><header className="entry-heading"><span className="entry-mark" aria-hidden="true">G</span><div><small>YOUR JOURNEY STARTS HERE</small><h2>Welcome to GENYX</h2></div></header><p className="entry-intro">Two simple steps to join the community.</p><div className="entry-step"><span>01</span><div><h3>Join our channels</h3><p>Stay connected with news and updates.</p></div></div><div className="entry-channels">{channels.map(c=><a className="entry-channel" key={c.inviteUrl} href={c.inviteUrl} target="_blank" rel="noopener noreferrer"><span className="entry-channel-icon" aria-hidden="true">↗</span><span className="entry-channel-name">{c.title}<small>Open Telegram channel</small></span><span className={`entry-badge ${c.verified ? "joined" : ""}`}>{c.verified ? "✓ Joined" : "Join"}</span></a>)}</div><div className="entry-step"><span>02</span><div><h3>Review the essentials</h3><p>Read and accept our community terms.</p></div></div><Terms request={request} onAccepted={setAccepted} /><button className="entry-continue" disabled={busy || !accepted} onClick={async()=>{setBusy(true); try { const r=await request<{verified:boolean;channels:typeof channels}>('/v1/onboarding/verify',{method:'POST'}); setChannels(r.channels); if(r.verified) done(); else setMessage('Please join all required channels first.'); }catch(e){setMessage('Unable to verify membership. Please check your connection and retry. If this persists, ask support to check the bot’s channel administrator permissions.');}finally{setBusy(false);}}}>{busy ? 'Checking…' : 'Verify & continue →'}</button><p role="status">{message}</p></section>;
}

export function Terms({ request, onAccepted }: { request: Request; onAccepted?: (accepted: boolean) => void }) {
  const [terms,setTerms]=useState<{text:string;version:string;accepted:boolean}|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  useEffect(()=>{ request<NonNullable<typeof terms>>('/v1/me/terms').then(r=>{setTerms(r);onAccepted?.(r.accepted);}).catch(()=>setError('Unable to load terms. Reopen this page to retry.')); },[]);
  return <section className="terms-consent"><details><summary>Read Terms of Service</summary><p style={{whiteSpace:'pre-wrap'}}>{terms?.text || 'Loading…'}</p></details><label><input type="checkbox" checked={terms?.accepted ?? false} disabled={!terms || busy || terms.accepted} onChange={async e=>{if(!e.target.checked||!terms)return;setBusy(true);try{await request('/v1/me/terms',{method:'POST',body:JSON.stringify({accepted:true,version:terms.version})});setTerms({...terms,accepted:true});onAccepted?.(true);}catch(e){setError(e instanceof Error?e.message:'Acceptance failed');}finally{setBusy(false);}}}/><span>I have read, understood and agree to the GENYX Terms of Service and User Rules.</span></label><p role="status">{busy?'Saving…':error}</p></section>;
}
