"use client";
import { useEffect, useState } from "react";
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Stats = {
  leftVolume: string;
  rightVolume: string;
  pendingLeftVolume?: string;
  pendingRightVolume?: string;
  cycles: string;
  maxCap: string;
  capConsumed: string;
  cycleVolume: string;
  cycleReward: string;
};
export function BinarySummary({ request }: { request: Request }) {
  const [stats, setStats] = useState<Stats | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      void request<Stats>("/v1/me/stats")
        .then((value) => {
          setStats(value);
          setError("");
        })
        .catch(() => setError("Could not refresh binary totals."));
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []);
  const usd = (s: string) =>
    (Number(s) / 1000000).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const cycleVolume = stats ? Number(stats.cycleVolume) / 1_000_000 : 10;
  const cycleReward = stats ? Number(stats.cycleReward) / 1_000_000 : 1;
  return (
    <section className="binary-summary">
      <h3>1 CYCLE FIXED = 1 USDT</h3>
      <details>
        <summary>Cycle calculation</summary>
        <p>
          When a package is purchased through a referral link, Fixed Cycles are
          generated according to the package and referral tables. Every $11 in
          eligible volume equals 1 Fixed Cycle, worth 1 USDT. Each cycle
          releases {cycleReward} USDT by matching {cycleVolume} USDT in each
          line, subject to daily limits and Max Cap. Lifetime team volume
          remains visible, and unmatched volume carries over to the next cycle.
        </p>
      </details>
      {stats && (
        <>
          <div className="binary-values">
            <div>
              <strong>
                {Number(stats.leftVolume) / Number(stats.cycleVolume)}
              </strong>
              <small>LEFT TOTAL CYCLES</small>
            </div>
            <div>
              <strong>
                {Number(stats.rightVolume) / Number(stats.cycleVolume)}
              </strong>
              <small>RIGHT TOTAL CYCLES</small>
            </div>
            <div>
              <strong>{stats.cycles}</strong>
              <small>CASH CYCLES</small>
            </div>
          </div>
          <h3>MAX CAP</h3>
          <progress
            max={Math.max(1, Number(stats.maxCap))}
            value={Number(stats.capConsumed)}
            aria-label="Used max cap"
          />
          <p>
            {usd(stats.capConsumed)} / {usd(stats.maxCap)} USDT
          </p>
        </>
      )}
      <p role="status">{error}</p>
    </section>
  );
}
