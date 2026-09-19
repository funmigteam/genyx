'use client';
import { useEffect, useState } from 'react';
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Stats = { leftVolume: string; rightVolume: string; pendingLeftVolume?: string; pendingRightVolume?: string; cycles: string; maxCap: string; capConsumed: string; cycleVolume: string; cycleReward: string };
export function BinarySummary({ request }: { request: Request }) {
  const [stats, setStats] = useState<Stats | null>(null), [error, setError] = useState('');
  useEffect(() => { const refresh = () => { void request<Stats>('/v1/me/stats').then(value => { setStats(value); setError(''); }).catch(() => setError('Could not refresh binary totals.')); }; refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, []);
  const usd = (s: string) => (Number(s) / 1000000).toLocaleString('en-US', { maximumFractionDigits: 6 });
  const cycleVolume = stats ? Number(stats.cycleVolume) / 1_000_000 : 0;
  const cycleReward = stats ? Number(stats.cycleReward) / 1_000_000 : 0;
  return <section className="binary-summary"><h3>BINARY 20%</h3><details><summary>How matching works</summary><p>Each fixed cycle matches {cycleVolume} USDT volume on both lines and earns {cycleReward} USDT before daily and max-cap limits. Lifetime team volume never decreases; unmatched operational volume stays ready for the next match.</p></details>{stats && <><div className="binary-values"><div><strong>{Number(stats.leftVolume) / Number(stats.cycleVolume)}</strong><small>LEFT TOTAL CYCLES</small></div><div><strong>{Number(stats.rightVolume) / Number(stats.cycleVolume)}</strong><small>RIGHT TOTAL CYCLES</small></div><div><strong>{stats.cycles}</strong><small>CASH CYCLES</small></div></div><h3>MAX CAP</h3><progress max={Math.max(1, Number(stats.maxCap))} value={Number(stats.capConsumed)} aria-label="Used max cap"/><p>{usd(stats.capConsumed)} / {usd(stats.maxCap)} USDT</p></>}<p role="status">{error}</p></section>;
}
