'use client';
import { useEffect, useState } from 'react';
export function HomeReferrals({ request }: { request: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const [stats, setStats] = useState<{direct:number;team:string;shareCode:string}|null>(null);
  const [message,setMessage] = useState('');
  useEffect(()=>{let active=true;const update=()=>request<NonNullable<typeof stats>>('/v1/me/stats').then(s=>{if(active)setStats(s);}).catch(()=>{if(active)setMessage('Unable to load referral counts.');});void update();const timer=setInterval(update,15000);return()=>{active=false;clearInterval(timer);};},[]);
  return <section className="home-referrals"><div><small>DIRECT REFERRALS</small><strong>{stats?.direct ?? '—'}</strong></div><div><small>TEAM MEMBERS</small><strong>{stats?.team ?? '—'}</strong></div><button disabled={!stats?.shareCode} onClick={async()=>{try{await navigator.clipboard.writeText(`https://t.me/smartgenyx_bot?startapp=ref_${stats!.shareCode}`);setMessage('Referral link copied. It opens GENYX directly in Telegram.');}catch{setMessage('Could not copy referral link.');}}}>Copy referral link</button><p role="status">{message}</p></section>;
}
