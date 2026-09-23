'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import './financial-flows.css';
import { Countdown } from './countdown';
import { BidCelebration } from './bid-celebration';
import { WinnerCelebration } from './winner-celebration';

type Intent = { id: string; amountUsdc: string; treasuryAddress: string; jettonMasterAddress: string; expiresAt: string };
type Day = { id: string; number: number; deadline: string; closedAt: string | null; claimedAt: string | null; graceAt: string | null; gift: string; giftGen: number; giftXp: number };
type Season = { id: string; season: number; currentDay: number; completedDays: number; graceUsed: number; endedAt: string | null; days: Day[] };
type Award = { id: string; userId: string; status: string; cents: string; expiresAt: string; prizeUsdt: string; prizeGen: number; prizeXp: number; revealedAt?: string | null };
type Auction = { id: string; title: string; status: string; remainingSeconds: number; _count?: { bids: number }; endsAt: string; bidGen: number; prizeUsdt: string; prizeGen: number; prizeXp: number; series?: string | null; round?: number | null; entryUsdt?: string; entryPaid?: boolean; entryCredits?: number; awards: Award[] };
type CompletedBidList = { total: number; rows: { cents: string; count: number }[]; truncated: boolean };
type AuctionPackage = { series: 'A' | 'B' | 'C'; priceUsdt: string; hallsIncluded: number; roomsRemaining: number };
const usd = (value: string) => { const n = BigInt(value); return `${n / 1000000n}.${String(n % 1000000n).padStart(6, '0').replace(/0+$/, '') || '00'}`; };

export function FinancialFlows({ token, userId, mode, changed, packageCode, onWithdraw }: { token: string; onWithdraw?: () => void; userId?: string; packageCode?: string | null; mode: 'seasons' | 'auctions'; changed: () => Promise<void> }) {
  const [history, setHistory] = useState<{ rows: (Auction & { _count: { bids: number } })[]; total: number }>({ rows: [], total: 0 });
  const [historyPage, setHistoryPage] = useState(0);
  const [seasons, setSeasons] = useState<Season[]>([]), [auctions, setAuctions] = useState<Auction[]>([]);
  const [auctionPackages, setAuctionPackages] = useState<AuctionPackage[]>([]);
  const [selectedAuctionPackage, setSelectedAuctionPackage] = useState<AuctionPackage['series'] | null>(null);
  const [completedBids, setCompletedBids] = useState<Record<string, CompletedBidList>>({});
  const [loadingCompletedBids, setLoadingCompletedBids] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({}), [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
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
    if (mode === 'seasons') {
      const [owned, catalog] = await Promise.all([request<Season[]>('/v1/me/seasons'), request<{ prices: Record<string, string> }>('/v1/seasons/catalog')]);
      setSeasons(owned); setPrices(catalog.prices);
    } else {
      const [rooms, packages] = await Promise.all([request<Auction[]>('/v1/auctions'), request<AuctionPackage[]>('/v1/auction-packages')]);
      setAuctions(rooms); setAuctionPackages(packages);
    }
    setLoading(false);
  }, [request, mode]);
  useEffect(() => {
    const update = () => { void refresh().catch(error => { setMessage(error.message); setLoading(false); }); };
    update(); const timer = setInterval(update, 10000); return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => { if(mode === 'auctions') request<typeof history>(`/v1/auctions/history?page=${historyPage}`).then(setHistory).catch(e => setMessage(e.message)); }, [request, mode, historyPage, auctions]);
  useEffect(() => {
    if (mode !== 'auctions' || !userId) return;
    const rows = [...auctions, ...history.rows];
    const award = rows.flatMap(room => room.awards).find(item => item.userId === userId && item.status === 'PAID' && !item.revealedAt);
    if (!award || revealingAwards.current.has(award.id)) return;
    revealingAwards.current.add(award.id);
    void request<{ revealed: boolean }>(`/v1/auctions/awards/${award.id}/reveal`, { method: 'POST', body: '{}' })
      .then(result => { if (result.revealed) setWinnerCelebration(award); })
      .catch(() => { revealingAwards.current.delete(award.id); });
  }, [auctions, history.rows, mode, request, userId]);
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
  const buyAuctionPackage = (item: AuctionPackage) => void run(async () => {
    await request(`/v1/auction-packages/${item.series}/purchase`, { requestKey: crypto.randomUUID() });
    setMessage(`${item.series} lottery package purchased. Two hall entries were added.`);
  });
  return <section className={`financial-flows${mode === 'auctions' ? ' lottery-experience' : ''}`} aria-label={mode === 'seasons' ? 'Season controls' : 'Auctions'} aria-busy={busy}>
    {celebration && <BidCelebration {...celebration} close={() => setCelebration(null)} />}
    {winnerCelebration && <WinnerCelebration award={winnerCelebration} close={() => setWinnerCelebration(null)} />}
    {mode === 'seasons' ? <h2>Your seasons</h2> : <><header className="lottery-hero"><div><span className="lottery-eyebrow">GENYX · LOWEST UNIQUE BID</span><h2>Small bids.<br /><em>Bright possibilities.</em></h2><p>Explore the halls. Find your number.</p><div className="lottery-tags"><span>USDT prizes</span><span>GEN rewards</span><span>XP boosts</span></div></div><svg className="lottery-trophy" viewBox="0 0 100 120" fill="none" aria-hidden="true"><path d="M28 15h44v30c0 30-44 30-44 0V15Z" fill="#ffd575"/><path d="M28 25H12v15c0 15 12 21 25 21M72 25h16v15c0 15-12 21-25 21M50 68v24M30 100h40" stroke="#ffd575" strokeWidth="7" strokeLinecap="round"/><path d="m50 27 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2 5-10Z" fill="#9f631d"/></svg></header><section className="lottery-package-area" aria-label="Lottery entry packs"><div className="lottery-package-strip">{auctionPackages.map(item=><button key={item.series} type="button" className={`lottery-package lottery-package--${item.series.toLowerCase()}${selectedAuctionPackage === item.series ? ' selected' : ''}`} aria-pressed={selectedAuctionPackage === item.series} onClick={() => setSelectedAuctionPackage(current => current === item.series ? null : item.series)}><span>{item.series} PACK</span></button>)}</div>{selectedAuctionPackage && (() => { const item = auctionPackages.find(candidate => candidate.series === selectedAuctionPackage); return item ? <article className={`lottery-package-details lottery-package--${item.series.toLowerCase()}`}><div><span>{item.series} PACK</span><h3>{usd(item.priceUsdt)} USDT</h3><p>This pack unlocks exactly {item.hallsIncluded} halls in series {item.series}. Your remaining entries: <b>{item.roomsRemaining}/{item.hallsIncluded}</b>.</p><p className="lottery-pack-gen-reward">For every 1 USDT paid, you receive 10 GEN — whether you win or lose.</p></div><button type="button" disabled={busy} onClick={() => buyAuctionPackage(item)}>Buy {item.series} pack</button></article> : null; })()}</section></>}
    <p role="status" aria-live="polite">{message || (loading ? 'Loading live records…' : '')}</p>
    {mode === 'seasons' ? <>
      {!loading && !seasons.length && <p>No season enrollment is recorded. New confirmed package purchases include season one.</p>}
      {seasons.map(season => { const day = season.days.find(d => !d.closedAt); return <article className="season-gift-card" key={season.id}>
        <h3>Season {season.season} · {season.endedAt ? 'Ended' : season.currentDay === 0 ? 'Queued' : `Day ${season.currentDay}`}</h3>
        <progress aria-label={`Season ${season.season} completion`} max={30} value={season.completedDays} />
        <p>{season.completedDays}/30 days completed · {season.graceUsed} Grace Days used</p>
        {day && <><h3>Daily gift · {usd(day.gift)} USDT + {day.giftGen ?? 0} GEN + {day.giftXp ?? 0} XP</h3><p>Claim deadline: <Countdown end={day.deadline} /></p>
          <button disabled={busy || Boolean(day.claimedAt || day.graceAt) || Date.parse(day.deadline) <= Date.now()} onClick={() => void run(async () => { await request(`/v1/seasons/days/${day.id}/gift`, {}); setMessage('Daily gift recorded.'); })}>Claim daily gift</button>
          {['PLATINUM', 'DIAMOND'].includes(packageCode ?? '') && <button disabled={busy || season.graceUsed >= (packageCode === 'DIAMOND' ? 2 : 1) || Boolean(day.claimedAt || day.graceAt) || Date.parse(day.deadline) <= Date.now()} onClick={() => void run(async () => { await request(`/v1/seasons/days/${day.id}/grace`, {}); setMessage('Grace Day applied.'); })}>Use one Grace Day</button>}
          <p>Complete all daily tasks and claim your gift before the deadline. Need more time? Buy a 24-hour extension in Shop before time runs out. A missed day restarts your progress at day 1, unless you use an available Grace Day.</p></>}
      </article>; })}
      {[2, 3, 4].map(number => <button key={number} disabled={busy || !prices[String(number)] || seasons.some(s => s.season === number) || !seasons.some(s => s.season === number - 1)} onClick={() => void run(async () => { setIntent(await request<Intent>('/v1/payments/season-intents', { season: number })); })}>Season {number} · {prices[String(number)] ?? '…'} USDT{seasons.some(s => s.season === number) ? ' · Owned' : ''}</button>)}
    </> : <>
      <details className="lottery-rules"><summary>How to play <span>One accepted bid = −1 second</span></summary><p>You can submit unlimited bids while a hall is open. Any USDT entry amount is charged only once for the series, not per bid. After entering C1, later C rooms are unlocked without another USDT charge. Each accepted bid costs GEN and removes one second.</p></details>
      {!loading && !auctions.some(a => a.status !== 'CLOSED') && <div className="lottery-empty"><span className="lottery-eyebrow">THE ARENA</span><h3>No open halls right now</h3><p>Past results are available below. New halls appear here when opened.</p></div>}
      {auctions.filter(a=>a.status !== 'CLOSED').map(auction => <article className="auction-room" key={auction.id}><h3>{auction.title}</h3><p className="room-status">{auction.status === "OPEN" ? "OPEN FOR BIDS" : "AWAITING WINNER PAYMENT"}</p><div className="bid-countdown"><span>BID COUNTDOWN</span><strong>{String(Math.floor(auction.remainingSeconds / 60)).padStart(2, "0")}:{String(auction.remainingSeconds % 60).padStart(2, "0")}</strong><small>Does not tick alone · each accepted bid −1s</small></div><div className="room-stats"><div><small>YOUR BIDS</small><strong>{auction._count?.bids ?? 0}</strong></div><div><small>WINNER</small><strong>{auction.awards.length ? auction.awards.map(a => a.userId === userId ? "You" : a.userId).join(", ") : auction.remainingSeconds === 0 ? "Selecting…" : "Not selected yet"}</strong></div></div><p>Cost per bid: {auction.bidGen} GEN · Each bid removes one second.</p>
        <p className="hall-prize"><small>HALL PRIZE</small>{usd(auction.prizeUsdt)} USDT + {auction.prizeGen} GEN + {auction.prizeXp} XP</p><p>{auction.series && ['A', 'B', 'C'].includes(auction.series) ? (auction.entryPaid ? `${auction.series} package active · ${auction.entryCredits} hall entry credit${auction.entryCredits === 1 ? '' : 's'} remaining` : `Purchase the ${auction.series} package above to enter two ${auction.series} halls`) : (auction.entryPaid || Number(auction.entryUsdt ?? 0) === 0 ? 'Entry unlocked · no extra USDT is charged per bid' : `Entry: ${usd(auction.entryUsdt ?? '0')} USDT (one-time)`)}</p>
        <form noValidate onSubmit={event => { event.preventDefault(); void submitBid(auction, event.currentTarget); }}>
          <label>Bid in US cents<input name="cents" inputMode="numeric" aria-describedby={`bid-feedback-${auction.id}`} disabled={busy || auction.status !== 'OPEN'} /></label>
          <small>Choose any positive whole number up to 12 digits, for example 1, 250 or 10000. There is no 1–25 limit.</small>
          <button type="submit" disabled={busy || auction.status !== 'OPEN' || auction.remainingSeconds <= 0}>{submittingRoom === auction.id ? 'Submitting…' : 'Place bid'} · {auction.bidGen} GEN{auction.series && ['A', 'B', 'C'].includes(auction.series) ? ` · ${auction.series} package required` : (!auction.entryPaid && Number(auction.entryUsdt ?? 0) > 0 ? ` + one-time ${usd(auction.entryUsdt ?? '0')} USDT entry` : '')}</button>
          <p id={`bid-feedback-${auction.id}`} role="status" aria-live="polite">{bidFeedback[auction.id] || (auction.status !== 'OPEN' || auction.remainingSeconds <= 0 ? 'This hall is no longer accepting bids.' : 'Unlimited bids are available while this hall is open.')}</p>
          {onWithdraw && bidFeedback[auction.id]?.includes('Insufficient USDT') && <div className="wallet-required" role="alert"><h4>Charge your user wallet first</h4><p>You need {usd(auction.entryUsdt ?? '0')} USDT in your internal wallet for this entry. A connected external wallet balance is not your in-app balance.</p><button type="button" onClick={onWithdraw}>Go to wallet & charge</button></div>}
        </form>
        {auction.awards.map(award => <p key={award.id}>Winner {award.userId === userId ? 'You' : award.userId} · {award.status} · {usd(award.prizeUsdt)} USDT
          {award.userId === userId && award.status === 'OFFERED' && <><br />Claim by {new Date(award.expiresAt).toLocaleString()}<button disabled={busy || Date.parse(award.expiresAt) <= Date.now()} onClick={() => void run(async () => { const settled = await request<{ chargedUsdt: string; creditedUsdt: string; netUsdt: string }>(`/v1/auctions/awards/${award.id}/claim`, {}); setMessage(`Winning bid charged from your in-app wallet. Prize credited: ${usd(settled.creditedUsdt)} USDT.`); })}>Claim prize · {usd(String(BigInt(award.cents) * 10000n))} USDT from wallet</button></>}
        </p>)}
      </article>)}
      <div className="lottery-history-heading"><div><span className="lottery-eyebrow">RESULTS ARCHIVE</span><h3>Completed rooms</h3></div><span className="lottery-total">{history.total} rooms</span></div>
      <div className="lottery-history-grid">{history.rows.map(a=>{const bidList=completedBids[a.id];return <article className="lottery-result" key={a.id}><header><h4>{a.title}</h4><span className="lottery-closed">{a.status}</span></header><div className="lottery-result-prize"><small>HALL PRIZE</small><strong>{usd(a.prizeUsdt)} <span>USDT</span></strong><div className="lottery-tags"><span>+ {a.prizeGen} GEN</span><span>+ {a.prizeXp} XP</span></div></div><div className="lottery-result-stats"><div><small>TOTAL BIDS</small><strong>{a._count.bids}</strong></div><div><small>COST PER BID</small><strong>{a.bidGen} <span>GEN</span></strong></div></div><footer>{a.awards.map(w=><div className={`lottery-winner${w.userId === userId && w.status === 'PAID' ? ' lottery-winner--paid' : ''}`} key={w.id}><small>WINNER · {w.status}</small><strong>{w.userId === userId ? 'You' : w.userId}</strong><p>Bid: {w.cents} cents · Share: {usd(w.prizeUsdt)} USDT</p>{w.userId === userId && w.status === 'PAID' && <b>Prize added to your available balance ✦</b>}</div>)}{!a.awards.length && <p>No eligible winner recorded.</p>}<details className="completed-bids" onToggle={event=>{if(event.currentTarget.open)void loadCompletedBids(a.id);}}><summary>View registered bids <span>{a._count.bids}</span></summary>{loadingCompletedBids[a.id]&&<p>Loading bids…</p>}{bidList&&<><p>{bidList.total} registered bids · {bidList.rows.length} unique numbers</p><div className="completed-bid-list">{bidList.rows.map(bid=><span key={bid.cents}><b>{bid.cents}</b>{bid.count > 1&&<small>×{bid.count}</small>}</span>)}</div>{bidList.truncated&&<p>First 1,000 unique bid numbers are shown.</p>}</>}</details>{onWithdraw && a.awards.some(w=>w.userId===userId && w.status==='PAID') && <button onClick={onWithdraw}>Withdraw available prize</button>}</footer></article>;})}</div>
      {!loading && !history.rows.length && <p className="lottery-empty">Completed halls and their results will appear here.</p>}
      {history.total > 20 && <nav className="lottery-pagination" aria-label="Room history pages"><button disabled={historyPage===0} onClick={()=>setHistoryPage(p=>p-1)}>Previous</button><span>Page {historyPage + 1}</span><button disabled={(historyPage+1)*20>=history.total} onClick={()=>setHistoryPage(p=>p+1)}>Next</button></nav>}
    </>}
    {intent && <article aria-label="Payment details"><h3>Payment · {intent.amountUsdc} USDT on TON</h3><p>Recipient: {intent.treasuryAddress}</p><p>Expires: {new Date(intent.expiresAt).toLocaleString()}</p>
      <a target="_blank" rel="noopener noreferrer" href={`https://app.tonkeeper.com/transfer/${encodeURIComponent(intent.treasuryAddress)}?jetton=${encodeURIComponent(intent.jettonMasterAddress)}&amount=${(() => { const [whole, decimals = ''] = intent.amountUsdc.split('.'); return BigInt(whole) * 1000000n + BigInt(decimals.padEnd(6, '0')); })()}&text=${encodeURIComponent(`GENYX:${intent.id}`)}`}>Open Tonkeeper payment</a>
      <p className="payment-auto-confirm">After sending, the system checks the on-chain payment automatically. You do not need to enter a transaction hash.</p>
      <button onClick={() => setIntent(null)}>Close payment details</button>
    </article>}
  </section>;
}
