"use client";
import { useEffect, useState } from "react";
type RankRow = { rank: number; name: string; amount: string };
type Board = {
  organizationalRank: number;
  organizationalTitle: string;
  me: { rank: number | null };
  rows: RankRow[];
};
export function Leaderboard({
  request,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const [data, setData] = useState<Board | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      request<Board>("/v1/commission-leaderboard")
        .then((value) => {
          if (live) {
            setData(value);
            setError("");
          }
        })
        .catch((e) => live && setError(e.message));
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const medal = (rank: number) =>
    rank === 1 ? "GOLD" : rank === 2 ? "SILVER" : rank === 3 ? "BRONZE" : "";
  return (
    <section className="member-panel rank-leaderboard">
      <small>ORGANIZATIONAL RANK</small>
      <h2>{data?.organizationalTitle ?? "Loading rank…"}</h2>
      <p>
        Only members in your current organizational rank compete here. Ranking
        is based on total credited USDT income.
      </p>
      <h3>Your position: {data?.me.rank ?? "—"}</h3>
      <p role="status">{error || (!data ? "Loading rankings…" : "")}</p>
      {data?.rows.map((row) => (
        <article key={row.rank} className={medal(row.rank).toLowerCase()}>
          <strong>
            #{row.rank} · {row.name}
          </strong>
          <span>
            {medal(row.rank) && <b>{medal(row.rank)} · </b>}
            {(Number(row.amount) / 1_000_000).toLocaleString("en-US")} USDT
          </span>
        </article>
      ))}
    </section>
  );
}
