'use client';
import {useEffect,useState} from 'react';
import {Countdown} from './countdown';
export function XpBoostStatus({request}:{request:<T>(path:string,init?:RequestInit)=>Promise<T>}){
 const [state,setState]=useState<{active:boolean;expiresAt:string|null}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;const load=()=>request<NonNullable<typeof state>>('/v1/me/xp-boost').then(s=>{if(live){setState(s);setError('');}}).catch(()=>{if(live)setError('Unable to load XP boost status.');});void load();const timer=setInterval(load,15000);return()=>{live=false;clearInterval(timer);};},[]);
 return <p role="status">{error||(!state?'Loading XP boost…':state.active?'2× task XP boost active':'No XP boost active')}{state?.active&&state.expiresAt&&<> · <Countdown end={state.expiresAt}/></>}</p>;
}
