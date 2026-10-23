'use client';
import { useCelebration } from './celebration';
import { useTonAddress, useTonWallet } from '@tonconnect/ui-react';
import { WalletVerification } from './wallet-verification';
import { useEffect, useRef, useState } from 'react';
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type State = { wallet: { address: string; verifiedAt: string | null } | null; balance: string; maxAmount: string; minimum: string; feeBps: number; automatic: boolean; autoPayoutMax: string; rows: { id: string; amount: string; netAmount: string; status: string }[] };
const usd = (n: string | bigint) => { const v = BigInt(n); return `${v / 1000000n}.${String(v % 1000000n).padStart(6, '0').replace(/0+$/, '') || '00'}`; };
export function WithdrawalPanel({ request, changed }: { request: Request; changed: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null), [amount, setAmount] = useState(''), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const connectedAddress = useTonAddress(false), friendlyAddress = useTonAddress();
  const connectedWallet = useTonWallet();
  const [motion, celebrate] = useCelebration();
  const walletMatches = Boolean(state?.wallet?.verifiedAt && connectedAddress && connectedAddress === state.wallet.address && connectedWallet?.account.chain === '-239');
  const retry = useRef<{ amount: string; destination: string; key: string } | null>(null), guard = useRef(false);
  const refresh = () => request<State>('/v1/me/withdrawals').then(setState);
  useEffect(() => { const update = () => { void refresh().catch(e => setMessage(e.message)); }; update(); const timer = setInterval(update, 15000); return () => clearInterval(timer); }, []);
  const atomic = /^\d+(\.\d{1,6})?$/.test(amount) ? BigInt(amount.split('.')[0]) * 1000000n + BigInt((amount.split('.')[1] || '').padEnd(6, '0')) : 0n;
  const fee = atomic * BigInt(state?.feeBps ?? 0) / 10000n;
  return <section className="withdrawal-card financial-flows">{motion}<h3>WITHDRAWABLE</h3><strong className="withdrawable-amount">{state ? usd(state.balance) : '…'} USDT</strong>
    {state && <p>Minimum {usd(state.minimum)} USDT · No daily limit · Fee {state.feeBps / 100}% · {state.automatic ? `Instant payout up to ${usd(state.autoPayoutMax)} USDT; larger amounts are reviewed first` : 'Manual review mode'}</p>}
    <button type="button" onClick={() => setOpen(!open)}>Withdraw</button>
    {open && <form onSubmit={async e => { e.preventDefault(); if (guard.current || !walletMatches || !state?.wallet || atomic < BigInt(state.minimum) || atomic > BigInt(state.maxAmount ?? '0')) return; guard.current = true; setBusy(true); setMessage(''); const value = String(atomic); if (retry.current?.amount !== value || retry.current?.destination !== connectedAddress) retry.current = { amount: value, destination: connectedAddress, key: crypto.randomUUID() }; try { const result = await request<{ id: string; status: string; automatic: boolean }>('/v1/withdrawals', { method: 'POST', body: JSON.stringify({ amount: value, destination: connectedAddress, idempotencyKey: retry.current.key }) }); retry.current = null; setAmount(''); celebrate({ kind: 'withdraw', title: result.automatic ? 'Withdrawal on its way' : 'Withdrawal requested', amount: (Number(value) / 1_000_000 * (1 - state.feeBps / 10_000)).toFixed(2), unit: 'USDT', detail: result.automatic ? 'Your USDT is being sent on-chain and usually arrives within two minutes.' : 'Your request is recorded and will be paid after review.' }); setMessage(result.automatic ? 'Withdrawal queued for immediate on-chain payout.' : state.automatic ? 'Withdrawal recorded. Amounts above the instant limit are paid automatically after admin approval.' : `Withdrawal recorded: ${result.status}.`); try { await refresh(); await changed(); } catch { setMessage('Withdrawal recorded. Refresh to see its latest status; do not submit it again.'); } } catch (error) { setMessage(error instanceof Error ? error.message : 'Withdrawal failed'); } finally { guard.current = false; setBusy(false); } }}>
      <p style={{overflowWrap:"anywhere"}}>Destination: {friendlyAddress || "Connect your wallet to withdraw."}</p>
      {!walletMatches && <><p>Connect and verify the same mainnet wallet before withdrawing. Changing your registered address costs 50 GEN; first registration is free.</p><WalletVerification request={request} /></>}
      <label>Amount (USDT)<input maxLength={24} inputMode="decimal" required disabled={busy} value={amount} onChange={e => setAmount(e.target.value)} placeholder="1.50" /><button type="button" disabled={busy || !state || BigInt(state.maxAmount ?? '0') < BigInt(state.minimum)} onClick={()=>setAmount(usd(state!.maxAmount))}>Max</button></label>
      <p>Fee deducted from USDT: {usd(fee)} · You receive: {usd(atomic - fee)} USDT</p>
      {state && <p>Available now: {usd(state.maxAmount ?? "0")} USDT. Submission is not confirmation of blockchain payment.</p>}
      <button disabled={busy || !walletMatches || atomic < BigInt(state?.minimum ?? '1') || atomic > BigInt(state?.maxAmount ?? '0')}>{busy ? 'Submitting…' : 'Confirm withdrawal'}</button>
    </form>}
    <p role="status">{message}</p>
    {open && state?.rows.map(row => <p key={row.id}>{usd(row.amount)} USDT · {row.status}</p>)}
  </section>;
}
