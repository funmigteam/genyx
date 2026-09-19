'use client';
import { useEffect, useState } from 'react';
export function ProfileEarnings({request}:{request:<T>(path:string,init?:RequestInit)=>Promise<T>}) {
 const [totals,setTotals]=useState<{reward:string;binary:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const update=()=>request<NonNullable<typeof totals>>('/v1/me/earning-totals').then(t=>{if(active){setTotals(t);setError('');}}).catch(()=>{if(active)setError('Unable to refresh earning totals.');});void update();const timer=setInterval(update,15000);return()=>{active=false;clearInterval(timer);};},[]);
 const money=(v:string)=>{const n=BigInt(v);return `${(n/1000000n).toLocaleString('en-US')}.${(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0')}`;};
 return <><div className="profile-stats profile-mini-stats earning-totals"><article><small>Total reward</small><strong>{totals?money(totals.reward):'—'} <small>USDT</small></strong><p>Daily gifts, tasks & lottery</p></article><article><small>Total binary</small><strong>{totals?money(totals.binary):'—'} <small>USDT</small></strong><p>Credited binary commissions</p></article></div>{error&&<p role="status">{error}</p>}</>;
}
