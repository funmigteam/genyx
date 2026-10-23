'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import './financial-flows.css';
import { Countdown } from './countdown';
import { useCelebration } from './celebration';
import { BidCelebration } from './bid-celebration';
import { WinnerCelebration } from './winner-celebration';

type Award = { id: string; userId: string; status: string; cents: string; expiresAt: string; prizeUsdt: string; prizeGen: number; prizeXp: number; revealedAt?: string | null };
type Auction = { id: string; title: string; status: string; remainingSeconds: number; _count?: { bids: number }; endsAt: string; bidGen: number; prizeUsdt: string; prizeGen: number; prizeXp: number; series?: string | null; round?: number | null; entryUsdt?: string; entryPaid?: boolean; entryCredits?: number; awards: Award[] ; hallPack?: boolean; packPriceUsdt?: string | null };
type CompletedBidList = { total: number; rows: { cents: string; count: number }[]; truncated: boolean };
const usd = (value: string) => { const n = BigInt(value); return `${n / 1000000n}.${String(n % 1000000n).padStart(6, '0').replace(/0+$/, '') || '00'}`; };

export function FinancialFlows({ token, userId, changed, onWithdraw }: { token: string; onWithdraw?: () => void; userId?: string; changed: () => Promise<void> }) {
  const [history, setHistory] = useState<{ rows: (Auction & { _count: { bids: number } })[]; total: number }>({ rows: [], total: 0 });
  const [historyPage, setHistoryPage] = useState(0);
  const [motion, celebrate] = useCelebration();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [completedBids, setCompletedBids] = useState<Record<string, CompletedBidList>>({});
  const [loadingCompletedBids, setLoadingCompletedBids] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const bidKeys = useRef(new Map<string, string>());
  const [bidFeedback, setBidFeedback] = useState<Record<string, string>>({});
  const [submittingRoom, setSubmittingRoom] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ cents: string; reward: string } | null>(null);
  const [winnerCelebration, setWinnerCelebration] = useState<Award | null>(null);
  const revealingAwards = useRef(new Set<string>());
  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response: Response;
    try {
      response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}${path}`, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Response timed out. The bid may have been recorded. Retry the same number to check safely.');
      throw error;
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${data.error ?? 'Request failed'}${typeof data.requestId === 'string' ? ` (Reference: ${data.requestId})` : ''}`);
    return data;
  }, [token]);
  const refresh = useCallback(async () => {
    setAuctions(await request<Auction[]>('/v1/auctions'));
    setLoading(false);
  }, [request]);
  useEffect(() => {
    const update = () => { void refresh().catch(error => { setMessage(error.message); setLoading(false); }); };
    update(); const timer = setInterval(update, 10000); return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => { request<typeof history>(`/v1/auctions/history?page=${historyPage}`).then(setHistory).catch(e => setMessage(e.message)); }, [request, historyPage, auctions]);
  useEffect(() => {
    if (!userId) return;
    const rows = [...auctions, ...history.rows];
    const award = rows.flatMap(room => room.awards).find(item => item.userId === userId && item.status === 'PAID' && !item.revealedAt);
    if (!award || revealingAwards.current.has(award.id)) return;
    revealingAwards.current.add(award.id);
    void request<{ revealed: boolean }>(`/v1/auctions/awards/${award.id}/reveal`, { method: 'POST', body: '{}' })
      .then(result => { if (result.revealed) setWinnerCelebration(award); })
      .catch(() => { revealingAwards.current.delete(award.id); });
  }, [auctions, history.rows, request, userId]);
  const run = async (action: () => Promise<void>) => {
    if (guard.current) return; guard.current = true; setBusy(true); setMessage('');
    try { await action(); await refresh(); await changed(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); }
    finally { guard.current = false; setBusy(false); }
  };
  const loadCompletedBids = async (auctionId: string) => {
    if (completedBids[auctionId] || loadingCompletedBids[auctionId]) return;
    setLoadingCompletedBids(previous => ({ ...previous, [auctionId]: true }));
    try { const result = await request<CompletedBidList>(`/v1/auctions/${auctionId}/bids`); setCompletedBids(previous => ({ ...previous, [auctionId]: result })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Completed bids could not be loaded.'); }
    finally { setLoadingCompletedBids(previous => ({ ...previous, [auctionId]: false })); }
  };
  const submitBid = async (auction: Auction, form: HTMLFormElement) => {
    if (guard.current) return;
    const cents = String(new FormData(form).get('cents') ?? '').trim()
      .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    const feedback = (value: string) => setBidFeedback(previous => ({ ...previous, [auction.id]: value }));
    if (!/^[1-9]\d{0,11}$/.test(cents)) { feedback('Enter a positive whole number in cents, for example 1 or 25.'); return; }
    guard.current = true; setBusy(true); setSubmittingRoom(auction.id); feedback('Submitting bid…');
    try {
      const key = `${auction.id}:${cents}`;
      let requestKey = bidKeys.current.get(key);
      if (!requestKey) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        requestKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        bidKeys.current.set(key, requestKey);
      }
      const result = await request<{ entryRewardGen?: string }>(`/v1/auctions/${auction.id}/bids`, { cents, requestKey });
      setCelebration({ cents, reward: result.entryRewardGen ?? '0' });
      bidKeys.current.delete(key); form.reset(); feedback(`Bid ${cents} recorded successfully.`);
      try { await refresh(); await changed(); } catch { feedback(`Bid ${cents} recorded. Refresh the page to see the updated balance.`); }
    } catch (error) { feedback(error instanceof Error ? error.message : 'Bid could not be submitted.'); }
    finally { guard.current = false; setBusy(false); setSubmittingRoom(null); }
  };
  // A lottery pack opens one named hall, once.
  const buyHallPack = (auction: Auction) => void run(async () => {
    const result = await request<{ rewardGen?: string }>(`/v1/auctions/${auction.id}/pack`, { requestKey: crypto.randomUUID() });
    setMessage(`${auction.series} pack bought for ${auction.title}.`);
    celebrate({ kind: 'unlock', title: `${auction.title} unlocked`, amount: String(result.rewardGen ?? '0'), unit: 'GEN', detail: `This ${auction.series} pack opens ${auction.title} only. 10 GEN for every 1 USDT was added to your balance.` });
  });
  const claimAward = (award: Award) => void run(async () => {
    const settled = await request<{ chargedUsdt: string; creditedUsdt: string; netUsdt: string }>(`/v1/auctions/awards/${award.id}/claim`, {});
    setMessage(`Winning bid charged from your in-app wallet. Prize credited: ${usd(settled.creditedUsdt)} USDT.`);
    celebrate({ kind: 'prize', title: 'You are the winner!', amount: usd(BigInt(settled.netUsdt) > 0n ? settled.netUsdt : '0'), unit: 'USDT', detail: `Prize ${usd(settled.creditedUsdt)} USDT − your winning bid ${usd(settled.chargedUsdt)} USDT. The rest is in your in-app wallet and ready to withdraw.`, action: onWithdraw ? 'Withdraw prize' : 'Continue', onAction: onWithdraw });
  });
  const live = auctions.filter(a => a.status === 'OPEN' && a.remainingSeconds > 0);
  const packHall = (a: Auction) => Boolean(a.series && ['A', 'B', 'C'].includes(a.series));
  const archiveStatus = (a: Auction) => a.status === 'AWAITING' ? 'AWAITING CLAIM' : a.status === 'OPEN' ? 'SELECTING WINNER' : a.status;
  return <section className="financial-flows lottery-experience" aria-label="Lottery" aria-busy={busy}>
    {celebration && <BidCelebration {...celebration} close={() => setCelebration(null)} />}
    {motion}
    {winnerCelebration && <WinnerCelebration award={winnerCelebration} close={() => setWinnerCelebration(null)} />}
    <header className="lottery-hero"><div><span className="lottery-eyebrow">GENYX · LOWEST UNIQUE BID</span><h2>Small bids.<br /><em>Bright possibilities.</em></h2><p>Explore the halls. Find your number.</p><div className="lottery-tags"><span>USDT prizes</span><span>GEN rewards</span><span>Hall packs</span></div></div><svg className="lottery-trophy" viewBox="0 0 100 120" fill="none" aria-hidden="true"><path d="M28 15h44v30c0 30-44 30-44 0V15Z" fill="#ffd575"/><path d="M28 25H12v15c0 15 12 21 25 21M72 25h16v15c0 15-12 21-25 21M50 68v24M30 100h40" stroke="#ffd575" strokeWidth="7" strokeLinecap="round"/><path d="m50 27 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2 5-10Z" fill="#9f631d"/></svg></header>
    <p role="status" aria-live="polite">{message || (loading ? 'Loading live records…' : '')}</p>
    <details className="lottery-rules"><summary>How to play <span>One accepted bid = −1 second</span></summary><p>Each A, B or C hall needs its own lottery pack: the C pack for C1 opens C1 only, and you can buy it once. Every 1 USDT spent on a pack adds 10 GEN to your balance, win or lose. Once inside, you can bid as often as you like while the hall is open; each accepted bid costs GEN and removes one second. When the countdown ends, the hall moves to Finished halls below.</p></details>
    {!loading && !live.length && <div className="lottery-empty"><span className="lottery-eyebrow">THE ARENA</span><h3>No open halls right now</h3><p>Finished halls are listed below. New halls appear here when opened.</p></div>}
    {live.map(auction => <article className="auction-room" key={auction.id}><h3>{auction.title}</h3><p className="room-status">OPEN FOR BIDS</p><div className="bid-countdown"><span>BID COUNTDOWN</span><strong>{String(Math.floor(auction.remainingSeconds / 60)).padStart(2, "0")}:{String(auction.remainingSeconds % 60).padStart(2, "0")}</strong><small>Does not tick alone · each accepted bid −1s</small></div><div className="room-stats"><div><small>YOUR BIDS</small><strong>{auction._count?.bids ?? 0}</strong></div><div><small>BID COST</small><strong>{auction.bidGen} GEN</strong></div></div>
      <p className="hall-prize"><small>HALL PRIZE</small>{usd(auction.prizeUsdt)} USDT + {auction.prizeGen} GEN</p>
      {packHall(auction) ? (auction.entryPaid
        ? <p className="hall-pack-active">✓ {auction.series} pack active for {auction.title}</p>
        : <div className={`hall-pack-offer lottery-package--${(auction.series ?? 'c').toLowerCase()}`}><div><span>{auction.series} PACK · {auction.title} ONLY</span><strong>{usd(auction.packPriceUsdt ?? '0')} USDT</strong><small>One-time entry to this hall · +{Number(auction.packPriceUsdt ?? 0) / 100000} GEN</small></div><button type="button" disabled={busy} onClick={() => buyHallPack(auction)}>Buy pack</button></div>)
        : <p>{auction.entryPaid || Number(auction.entryUsdt ?? 0) === 0 ? 'Entry unlocked · no extra USDT is charged per bid' : `Entry: ${usd(auction.entryUsdt ?? '0')} USDT (one-time)`}</p>}
        <form noValidate onSubmit={event => { event.preventDefault(); void submitBid(auction, event.currentTarget); }}>
          <label>Bid in US cents<input name="cents" inputMode="numeric" aria-describedby={`bid-feedback-${auction.id}`} disabled={busy || auction.status !== 'OPEN'} /></label>
          <small>Choose any positive whole number up to 12 digits, for example 1, 250 or 10000. There is no 1–25 limit.</small>
          <button type="submit" disabled={busy || auction.status !== 'OPEN' || auction.remainingSeconds <= 0 || (packHall(auction) && !auction.entryPaid)}>{submittingRoom === auction.id ? 'Submitting…' : 'Place bid'} · {auction.bidGen} GEN{packHall(auction) ? (auction.entryPaid ? '' : ` · ${auction.series} pack required`) : (!auction.entryPaid && Number(auction.entryUsdt ?? 0) > 0 ? ` + one-time ${usd(auction.entryUsdt ?? '0')} USDT entry` : '')}</button>
          <p id={`bid-feedback-${auction.id}`} role="status" aria-live="polite">{bidFeedback[auction.id] || (auction.status !== 'OPEN' || auction.remainingSeconds <= 0 ? 'This hall is no longer accepting bids.' : 'Unlimited bids are available while this hall is open.')}</p>
          {onWithdraw && bidFeedback[auction.id]?.includes('Insufficient USDT') && <div className="wallet-required" role="alert"><h4>Charge your user wallet first</h4><p>You need {usd(auction.entryUsdt ?? '0')} USDT in your internal wallet for this entry. A connected external wallet balance is not your in-app balance.</p><button type="button" onClick={onWithdraw}>Go to wallet & charge</button></div>}
        </form>
      </article>)}
      <div className="lottery-history-heading"><div><span className="lottery-eyebrow">RESULTS ARCHIVE</span><h3>Finished halls</h3></div><span className="lottery-total">{history.total} rooms</span></div>
      <div className="lottery-history-grid">{history.rows.map(a=>{const bidList=completedBids[a.id];return <article className="lottery-result" key={a.id}><header><h4>{a.title}</h4><span className="lottery-closed">{archiveStatus(a)}</span></header><div className="lottery-result-prize"><small>HALL PRIZE</small><strong>{usd(a.prizeUsdt)} <span>USDT</span></strong><div className="lottery-tags"><span>+ {a.prizeGen} GEN</span></div></div><div className="lottery-result-stats"><div><small>TOTAL BIDS</small><strong>{a._count.bids}</strong></div><div><small>COST PER BID</small><strong>{a.bidGen} <span>GEN</span></strong></div></div><footer>{a.awards.filter(w=>w.status!=='EXPIRED').map(w=>{const bid=BigInt(w.cents)*10000n, net=BigInt(w.prizeUsdt)-bid;return <div className={`lottery-winner${w.userId === userId && w.status === 'PAID' ? ' lottery-winner--paid' : ''}`} key={w.id}><small>{w.status === 'PAID' ? 'WINNER · PRIZE PAID' : 'WINNER · WAITING FOR CLAIM'}</small><strong>{w.userId === userId ? 'You' : `Member ${w.userId.slice(-6)}`}</strong><p>Winning bid: {w.cents} · Prize: {usd(w.prizeUsdt)} USDT</p>{w.userId === userId && w.status === 'PAID' && <b>Prize added to your available balance ✦</b>}{w.userId === userId && w.status === 'OFFERED' && <div className="archive-claim"><p>You won! Prize {usd(w.prizeUsdt)} − your bid {usd(String(bid))} = <b>{usd(String(net > 0n ? net : 0n))} USDT</b> to your wallet. Claim by {new Date(w.expiresAt).toLocaleString()}.</p><button disabled={busy || Date.parse(w.expiresAt) <= Date.now()} onClick={() => claimAward(w)}>Withdraw prize · {usd(String(net > 0n ? net : 0n))} USDT</button></div>}</div>;})}{a.awards.some(w=>w.status==='EXPIRED') && <p className="lottery-passed">{a.awards.filter(w=>w.status==='EXPIRED').length} earlier offer(s) were not claimed within 24 hours and passed to the next unique bid.</p>}{!a.awards.length && <p>No eligible winner recorded.</p>}<details className="completed-bids" onToggle={event=>{if(event.currentTarget.open)void loadCompletedBids(a.id);}}><summary>View registered bids <span>{a._count.bids}</span></summary>{loadingCompletedBids[a.id]&&<p>Loading bids…</p>}{bidList&&<><p>{bidList.total} registered bids · {bidList.rows.length} unique numbers</p><div className="completed-bid-list">{bidList.rows.map(bid=><span key={bid.cents}><b>{bid.cents}</b>{bid.count > 1&&<small>×{bid.count}</small>}</span>)}</div>{bidList.truncated&&<p>First 1,000 unique bid numbers are shown.</p>}</>}</details>{onWithdraw && a.awards.some(w=>w.userId===userId && w.status==='PAID') && <button onClick={onWithdraw}>Withdraw available prize</button>}</footer></article>;})}</div>
      {!loading && !history.rows.length && <p className="lottery-empty">Finished halls and their results will appear here.</p>}
      {history.total > 20 && <nav className="lottery-pagination" aria-label="Room history pages"><button disabled={historyPage===0} onClick={()=>setHistoryPage(p=>p-1)}>Previous</button><span>Page {historyPage + 1}</span><button disabled={(historyPage+1)*20>=history.total} onClick={()=>setHistoryPage(p=>p+1)}>Next</button></nav>}
  </section>;
}
