"use client";
import { useEffect, useState } from "react";
type RankRow = { rank: number; name: string; amount: string; isMe?: boolean };
type Group = { level: number; rank: string; members: number; rows: RankRow[] };
type Board = {
  organizationalRank: number;
  organizationalTitle: string;
  me: { rank: number | null };
  rows: RankRow[];
  groups?: Group[];
};
export function Leaderboard({
  request,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const [data, setData] = useState<Board | null>(null),
    [error, setError] = useState(""),
    [level, setLevel] = useState<number | null>(null);
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
  const groups = data?.groups ?? [];
  // Default to the member's own rank; lower ranks are one tap away.
  const selected =
    groups.find((group) => group.level === level) ?? groups[0] ?? null;
  return (
    <section className="member-panel rank-leaderboard">
      <small>ORGANIZATIONAL RANK</small>
      <h2>{data?.organizationalTitle ?? "Loading rank…"}</h2>
      <p>
        You can see your own rank and every rank below it. Within each rank,
        members are ordered by total credited USDT income.
      </p>
      <h3>Your position: {data?.me.rank ?? "—"}</h3>
      {groups.length > 1 && (
        <div className="rank-tabs" role="tablist" aria-label="Ranks">
          {groups.map((group) => (
            <button
              key={group.level}
              role="tab"
              aria-selected={selected?.level === group.level}
              onClick={() => setLevel(group.level)}
            >
              <span className={`rank-badge rank-${group.rank.toLowerCase()}`}>
                {group.rank}
              </span>
              <small>
                Level {group.level} · {group.members}
              </small>
            </button>
          ))}
        </div>
      )}
      <p role="status">{error || (!data ? "Loading rankings…" : "")}</p>
      {selected && !selected.rows.length && (
        <p>No members at {selected.rank} yet.</p>
      )}
      {(selected?.rows ?? data?.rows ?? []).map((row) => (
        <article
          key={row.rank}
          className={`${medal(row.rank).toLowerCase()}${row.isMe ? " me" : ""}`}
        >
          <strong>
            #{row.rank} · {row.isMe ? "You" : row.name}
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
