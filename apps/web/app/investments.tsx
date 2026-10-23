'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TonConnectPay, type TonConnectTransfer } from './ton-connect-pay';
import { useCelebration } from './celebration';
import './investments.css';

type Plan = { code: string; principal: string; monthlyProfit: string; monthlyTokens: string; maxProfit: string; maxCap: string; fixedCycles: number; allowed?: boolean; requiredPackage?: string | null };
type Investment = Plan & {
  id: string; planCode: string; profitPaid: string; tokensPaid: string; valueConsumed: string; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  profitLocked: string; profitReleasedAt: string | null; profitTarget: string; canWithdrawProfit: boolean; commissionsCounted: string; profitComplete: boolean;
  accrual: Accrual; serverTime: string;
  startedAt: string; nextSettlementAt: string | null; refundAmount: string | null;
  cancellation: { eligible: boolean; deadline: string; refund: string; deductions: string };
};
type Accrual = { pendingProfit: string; pendingTokens: string; profitPerDay: string; tokensPerDay: number; periodStart: string | null; nextSettlementAt: string | null };
type Intent = { id: string; amountUsdc: string; treasuryAddress: string; jettonMasterAddress: string; expiresAt: string };
type Request = <T,>(path: string, init?: RequestInit) => Promise<T>;

const usd = (atomic: string | number) => (Number(atomic) / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const percent = (part: string, whole: string) => Math.min(100, (Number(part) / Math.max(1, Number(whole))) * 100);

/** Max Cap is the ceiling of the bar; the Max Profit point is marked on it. */
function CapBar({ value, maxProfit, maxCap }: { value: string; maxProfit: string; maxCap: string }) {
  const filled = percent(value, maxCap), profitMark = percent(maxProfit, maxCap);
  return <div className="invest-bar">
    <div><span>Max Cap progress</span><b>{usd(value)} / {usd(maxCap)} USDT</b></div>
    <div className="invest-track invest-cap" role="progressbar" aria-label="Max Cap progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled)}>
      <i style={{ width: `${filled}%` }} />
      <em style={{ left: `${profitMark}%` }} title={`Max Profit ${usd(maxProfit)} USDT`} />
    </div>
    <div className="invest-cap-legend"><span>0</span><span style={{ left: `${profitMark}%` }}>Max Profit {usd(maxProfit)}</span><span>Max Cap {usd(maxCap)}</span></div>
  </div>;
}

/**
 * Counts up from 0 on load, then keeps growing at the real accrual rate
 * reported by the server; it never invents figures beyond that rate.
 */
function useLive(base: number, perDay: number, active: boolean) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const started = performance.now(), reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const tick = () => {
      const ms = performance.now() - started, intro = reduce ? 1 : Math.min(1, ms / 1200);
      setValue(base * (1 - (1 - intro) ** 3) + (active ? perDay * ms / 86_400_000 : 0));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [base, perDay, active]);
  return value;
}

function LiveNumber({ base, perDay, active, digits, unit }: { base: number; perDay: number; active: boolean; digits: number; unit: string }) {
  const value = useLive(base, perDay, active);
  return <b className={active && perDay > 0 ? 'invest-live' : undefined}>{value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} <small>{unit}</small></b>;
}

function InvestmentDashboard({ investments }: { investments: Investment[] }) {
  const active = investments.filter(row => row.status === 'ACTIVE');
  const sum = (pick: (row: Investment) => number) => active.reduce((total, row) => total + pick(row), 0);
  const monthlyProfit = sum(row => row.profitComplete ? 0 : Number(row.monthlyProfit) / 1e6);
  const monthlyTokens = sum(row => Number(row.monthlyTokens));
  const mined = investments.reduce((total, row) => total + Number(row.tokensPaid), 0);
  const next = active.map(row => row.accrual.nextSettlementAt).filter((value): value is string => Boolean(value)).sort()[0];
  const days = next ? Math.max(0, Math.ceil((Date.parse(next) - Date.now()) / 86_400_000)) : null;
  return <section className="invest-dashboard" aria-label="Investment dashboard">
    <article><small>Monthly profit</small><LiveNumber base={monthlyProfit} perDay={0} active={false} digits={2} unit="USDT" /><p>{active.length} active pack{active.length === 1 ? '' : 's'} · {monthlyTokens.toLocaleString('en-US')} GEN / month</p></article>
    <article><small>Token Miner mined</small><LiveNumber base={mined} perDay={0} active={false} digits={0} unit="GEN" /><p>Credited to your GEN balance</p></article>
    <article className="accent"><small>Tokens pending settlement</small><LiveNumber base={sum(row => Number(row.accrual.pendingTokens))} perDay={sum(row => row.accrual.tokensPerDay)} active={active.length > 0} digits={2} unit="GEN" /><p>Profit accrued: <LiveNumber base={sum(row => Number(row.accrual.pendingProfit) / 1e6)} perDay={sum(row => Number(row.accrual.profitPerDay) / 1e6)} active={active.length > 0} digits={4} unit="USDT" /></p></article>
    <article><small>Next settlement</small><b>{next ? date(next) : '—'}</b><p>{days === null ? 'No active pack' : days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'}`}</p></article>
  </section>;
}

export function InvestmentPanel({ request, changed }: { request: Request; changed: () => Promise<void> }) {
  const [plans, setPlans] = useState<Plan[]>([]), [mine, setMine] = useState<Investment[]>([]);
  const [intent, setIntent] = useState<(Intent & { plan: Plan }) | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null), [pending, setPending] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLElement>(null);
  const guard = useRef(false);
  const [celebration, celebrate] = useCelebration();
  // The caller's request function changes identity every render.
  const requestRef = useRef(request);
  requestRef.current = request;
  const load = useCallback(async () => {
    try { const result = await requestRef.current<{ plans: Plan[]; investments: Investment[] }>('/v1/investments'); setPlans(result.plans); setMine(result.investments); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Investments are unavailable.'); }
  }, []);
  // Re-sync the live counters with the server every minute.
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 60_000); return () => clearInterval(timer); }, [load]);
  // The checkout opens inside the chosen card; bring it into view on phones.
  useEffect(() => { if (intent) checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [intent]);

  const start = async (plan: Plan) => {
    if (guard.current) return; guard.current = true; setBusy(true); setMessage(''); setPending(plan.code); setIntent(null);
    try { setIntent({ ...await request<Intent>('/v1/payments/investment-intents', { method: 'POST', body: JSON.stringify({ planCode: plan.code }) }), plan }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start the investment.'); }
    finally { guard.current = false; setBusy(false); }
  };
  const withdrawProfit = async (investment: Investment) => {
    if (guard.current) return; guard.current = true; setBusy(true); setMessage(''); setPending(null);
    try {
      const result = await request<{ amount: string }>(`/v1/investments/${investment.id}/withdraw-profit`, { method: 'POST' });
      celebrate({ kind: 'withdraw', title: 'Max Profit reached!', amount: String(Number(result.amount) / 1_000_000), unit: 'USDT',
        detail: 'Your full investment profit is now in your wallet and ready to withdraw.' });
      await Promise.all([load(), changed()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Profit withdrawal failed.'); }
    finally { guard.current = false; setBusy(false); }
  };
  const cancel = async (investment: Investment) => {
    if (guard.current) return; guard.current = true; setBusy(true); setMessage(''); setPending(null);
    try {
      const result = await request<Investment>(`/v1/investments/${investment.id}/cancel`, { method: 'POST' });
      setConfirming(null);
      celebrate({ kind: 'refund', title: 'Investment cancelled', amount: String(Number(result.refundAmount ?? 0) / 1_000_000), unit: 'USDT',
        detail: Number(result.refundAmount ?? 0) > 0 ? 'The refund was added to your in-app wallet.' : 'Deductions equalled the principal, so no refund was due.' });
      await Promise.all([load(), changed()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cancellation failed.'); }
    finally { guard.current = false; setBusy(false); }
  };

  const checkout = intent && <article className="invest-checkout" aria-label="Investment payment" ref={checkoutRef}>
      <h3>Pay {intent.amountUsdc} USDT</h3>
      <p>Your wallet receives a fixed amount and recipient. The investment starts automatically once the payment is confirmed on-chain.</p>
      <TonConnectPay
        loadTransfer={address => request<TonConnectTransfer>(`/v1/payments/${intent.id}/ton-connect-transfer`, { method: 'POST', body: JSON.stringify({ address }) })}
        onSent={() => {
          celebrate({ kind: 'invest', title: 'Investment payment sent', amount: String(Number(intent.plan.principal) / 1_000_000), unit: 'USDT', detail: `Your ${usd(intent.plan.monthlyProfit)} USDT monthly profit and ${intent.plan.monthlyTokens} miner tokens start after confirmation.` });
          window.setTimeout(() => void load(), 60_000);
        }}
      />
      <p>Expires {new Date(intent.expiresAt).toLocaleString()}</p>
      <button onClick={() => { setIntent(null); setPending(null); }}>Close</button>
  </article>;

  return <section className="invest-panel">
    {celebration}
    <header className="invest-intro">
      <span>INVESTMENT PACKS</span>
      <h2>Monthly Profit + Miner Tokens</h2>
      <p>30 days after activating an Investment Package, monthly USDT profit is added to your locked balance, and miner tokens are credited as GEN.</p>
      <p>For example, the $110 package generates <b>$3 monthly profit and 30 GEN tokens</b>. Profit and all USDT commissions count toward Max Profit and Max Cap progress. Payments stop when Max Profit is reached.</p>
      <p className="invest-note">Each package also generates Fixed Cycles for sponsors at a rate of 1 cycle per $11. Profit figures are not guaranteed. See Terms 4–5.</p>
    </header>

    <div className="invest-plans">
      {plans.map(plan => <article key={plan.code} className={plan.allowed === false ? 'locked' : undefined}>
        <span className="invest-price">{usd(plan.principal)} <small>USDT</small></span>
        <dl>
          <div><dt>Monthly profit</dt><dd>{usd(plan.monthlyProfit)} USDT</dd></div>
          <div><dt>Miner tokens / month</dt><dd>{Number(plan.monthlyTokens).toLocaleString('en-US')} GEN</dd></div>
          <div><dt>Max profit</dt><dd>{usd(plan.maxProfit)} USDT</dd></div>
          <div><dt>Max cap</dt><dd>{usd(plan.maxCap)} USDT</dd></div>
          <div><dt>Fixed cycles</dt><dd>{plan.fixedCycles.toLocaleString('en-US')}</dd></div>
        </dl>
        {plan.allowed === false
          ? <p className="invest-locked">🔒 Needs the {plan.requiredPackage ?? 'a higher'} token package (packs up to 10× your token package).</p>
          : <button className="primary" disabled={busy} onClick={() => void start(plan)}>{busy && pending === plan.code ? 'Preparing payment…' : `Invest ${usd(plan.principal)} USDT`}</button>}
        {pending === plan.code && message && <p role="alert" className="invest-message">{message}</p>}
        {intent?.plan.code === plan.code && checkout}
      </article>)}
    </div>


    {mine.length > 0 && <>
      <h3 className="invest-heading">Your investments</h3>
      <InvestmentDashboard investments={mine} />
      <div className="invest-mine">
        {mine.map(investment => <article key={investment.id} data-status={investment.status}>
          <header><b>{usd(investment.principal)} USDT</b><span className={`invest-status ${investment.status.toLowerCase()}`}>{investment.status}</span></header>
          <CapBar value={investment.valueConsumed} maxProfit={investment.maxProfit} maxCap={investment.maxCap} />
          <div className="invest-math" aria-label="Max Profit calculation">
            <div><span>USDT profit earned</span><b>{usd(investment.profitPaid)}</b></div>
            <div><span>+ USDT commissions counted</span><b>{usd(investment.commissionsCounted)}</b></div>
            <div className="total"><span>= Progress (USDT only)</span><b>{usd(investment.valueConsumed)} USDT</b></div>
            <div><span>{investment.profitComplete ? 'Max Profit reached' : 'Left until Max Profit'}</span><b>{usd(Math.max(0, Number(investment.maxProfit) - Number(investment.valueConsumed)))} USDT</b></div>
            <div><span>Miner tokens received</span><b>{Number(investment.tokensPaid).toLocaleString('en-US')} GEN</b></div>
          </div>
          {Number(investment.profitLocked) > 0 && <div className={`invest-vault${investment.canWithdrawProfit ? ' ready' : ''}`}>
            <span aria-hidden="true">{investment.canWithdrawProfit ? '🔓' : '🔒'}</span>
            <div><small>{investment.canWithdrawProfit ? 'Unlocked profit' : 'Locked profit · unlocks when the Max Profit bar is full'}</small><b>{usd(investment.profitLocked)} USDT</b></div>
            {investment.canWithdrawProfit && <button className="primary" disabled={busy} onClick={() => void withdrawProfit(investment)}>Withdraw profit</button>}
          </div>}
          {investment.profitReleasedAt && <p>Profit moved to your wallet on {date(investment.profitReleasedAt)}.</p>}
          <p>Started {date(investment.startedAt)} · {investment.status === 'ACTIVE' ? 'miner tokens stay active until the Max Cap bar is full.' : investment.status === 'COMPLETED' ? 'Max Cap reached: miner tokens are locked.' : 'cancelled.'}</p>
          {investment.status === 'ACTIVE' && investment.accrual.nextSettlementAt && <div className="invest-pending">
            <div><small>Pending this period</small><LiveNumber base={Number(investment.accrual.pendingProfit) / 1e6} perDay={Number(investment.accrual.profitPerDay) / 1e6} active digits={4} unit="USDT" /></div>
            <div><small>Tokens pending</small><LiveNumber base={Number(investment.accrual.pendingTokens)} perDay={investment.accrual.tokensPerDay} active digits={2} unit="GEN" /></div>
            <div><small>Next settlement</small><b>{date(investment.accrual.nextSettlementAt)}</b></div>
          </div>}
          {investment.status === 'CANCELLED' && <p>Refunded {usd(investment.refundAmount ?? '0')} USDT to your wallet.</p>}
          {investment.cancellation.eligible && (confirming === investment.id
            ? <div className="invest-cancel" role="alertdialog" aria-label="Confirm cancellation">
                <p>Refund now: <b>{usd(investment.cancellation.refund)} USDT</b>. Deducted: {usd(investment.cancellation.deductions)} USDT (profits received, token value and commissions paid). This cannot be undone.</p>
                <button disabled={busy} className="danger" onClick={() => void cancel(investment)}>Confirm cancellation</button>
                <button disabled={busy} onClick={() => setConfirming(null)}>Keep investment</button>
              </div>
            : <button className="invest-cancel-open" onClick={() => setConfirming(investment.id)}>Cancel (until {date(investment.cancellation.deadline)})</button>)}
        </article>)}
      </div>
    </>}
    {message && !pending && <p role="status" className="invest-message">{message}</p>}
  </section>;
}
